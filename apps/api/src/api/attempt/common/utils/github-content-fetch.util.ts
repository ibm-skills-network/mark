import { Logger } from "@nestjs/common";
import * as cheerio from "cheerio";
import { GithubRateLimitedError } from "src/api/llm/features/grading/errors/github-rate-limited.error";
import { getGithubGradingApiToken } from "src/config/github-grading-token";
import {
  isGithubRateLimitResponse,
  parseGithubRateLimitInfo,
} from "./github-rate-limit-detection.util";
import { safeGet } from "./ssrf-safe-http";

/**
 * Single, deduplicated implementation of the "learner submitted a GitHub (or
 * arbitrary) URL, fetch something gradeable out of it" fetch pipeline.
 * Before this file existed, this exact logic (main/master-only README
 * guessing, an unauthenticated final api.github.com call, and an HTML-
 * scrape fallback) was hand-copied into three call sites:
 *   - UrlGradingStrategy.fetchUrlContent
 *   - AttemptHelper.fetchPlainTextFromUrl
 *   - QuestionResponseService.fetchUrlContent
 * All three now delegate here so branch-resolution and rate-limit fixes
 * land once.
 */

const logger = new Logger("GithubContentFetch");

const GITHUB_API_VERSION = "2022-11-28";

/**
 * GET against api.github.com with the optional server token attached, and
 * the rate-limit response translated into a typed, retryable error. This
 * still goes through `safeGet`, so the SSRF guard (scheme allow-list +
 * per-connection DNS re-check) applies exactly as it does for the raw
 * README/blob fetches below.
 */
export async function githubApiGet<T>(
  requestUrl: string,
  owner: string,
  repo: string,
): Promise<T> {
  // Defense in depth: this helper exists specifically to attach the server's
  // GitHub token, so a caller-constructed URL that resolves anywhere other
  // than api.github.com must never reach safeGet. This is a programmer-error
  // guard (every call site builds requestUrl from a literal
  // "https://api.github.com/..." template), not a learner-facing error.
  let host: string;
  try {
    host = new URL(requestUrl).hostname;
  } catch {
    throw new Error("githubApiGet requires an api.github.com URL");
  }
  if (host !== "api.github.com") {
    throw new Error("githubApiGet requires an api.github.com URL");
  }

  const token = getGithubGradingApiToken();
  try {
    const response = await safeGet<T>(requestUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    return response.data;
  } catch (error) {
    const response = (
      error as {
        response?: { status?: number; headers?: Record<string, unknown> };
      }
    )?.response;
    if (
      typeof response?.status === "number" &&
      isGithubRateLimitResponse(response.status, response.headers)
    ) {
      const { resetAt, retryAfterSeconds } = parseGithubRateLimitInfo(
        response.headers,
      );
      logger.warn(
        `GitHub API rate limit hit for ${owner}/${repo} (authenticated=${token ? "true" : "false"}, resetAt=${resetAt ?? "unknown"})`,
      );
      throw new GithubRateLimitedError({
        owner,
        repo,
        requestUrl,
        resetAt,
        retryAfterSeconds,
      });
    }
    throw error;
  }
}

interface GithubRepoDescriptor {
  default_branch?: string;
}

/**
 * A grading run that asks the same URL-context question for K learners (or
 * a single assignment with K questions sharing one repo-root URL) previously
 * cost K identical `GET /repos/{owner}/{repo}` calls. Memoize the resolved
 * branch per owner/repo for a short window so repeated lookups within the
 * same grading burst reuse one API call instead of amplifying rate-limit
 * pressure. Only successful resolutions are cached — a rate-limited or
 * otherwise-failed lookup must be retried on the next call, never served
 * stale-failed from here.
 */
const DEFAULT_BRANCH_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_BRANCH_CACHE_MAX_ENTRIES = 500;

interface DefaultBranchCacheEntry {
  branch: string;
  expiresAt: number;
}

const defaultBranchCache = new Map<string, DefaultBranchCacheEntry>();

function defaultBranchCacheKey(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

function getCachedDefaultBranch(
  owner: string,
  repo: string,
): string | undefined {
  const key = defaultBranchCacheKey(owner, repo);
  const entry = defaultBranchCache.get(key);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt <= Date.now()) {
    defaultBranchCache.delete(key);
    return undefined;
  }
  return entry.branch;
}

function setCachedDefaultBranch(
  owner: string,
  repo: string,
  branch: string,
): void {
  const key = defaultBranchCacheKey(owner, repo);
  if (
    !defaultBranchCache.has(key) &&
    defaultBranchCache.size >= DEFAULT_BRANCH_CACHE_MAX_ENTRIES
  ) {
    // Bound memory with simple FIFO eviction: Map iteration order is
    // insertion order, so the first key is the oldest entry.
    const oldestKey = defaultBranchCache.keys().next().value;
    if (oldestKey !== undefined) {
      defaultBranchCache.delete(oldestKey);
    }
  }
  defaultBranchCache.set(key, {
    branch,
    expiresAt: Date.now() + DEFAULT_BRANCH_CACHE_TTL_MS,
  });
}

/** Test-only escape hatch: clears the module-level default-branch cache so specs don't leak state across cases. Not called from production code paths. */
export function clearGithubDefaultBranchCache(): void {
  defaultBranchCache.clear();
}

/**
 * Resolves a GitHub repository's actual default branch via
 * `GET /repos/{owner}/{repo}`, memoized per owner/repo (see cache doc
 * comment above). Returns undefined (never throws, other than
 * GithubRateLimitedError) when the lookup fails for any other reason —
 * network hiccup, private/nonexistent repo, unexpected response shape — so
 * callers can fall back to guessing main/master exactly like before this
 * function existed.
 */
export async function resolveGithubDefaultBranch(
  owner: string,
  repo: string,
): Promise<string | undefined> {
  const cached = getCachedDefaultBranch(owner, repo);
  if (cached !== undefined) {
    return cached;
  }

  const requestUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  try {
    const data = await githubApiGet<GithubRepoDescriptor>(
      requestUrl,
      owner,
      repo,
    );
    if (data.default_branch) {
      setCachedDefaultBranch(owner, repo, data.default_branch);
    }
    return data.default_branch;
  } catch (error) {
    if (error instanceof GithubRateLimitedError) {
      throw error;
    }
    logger.warn(
      `Could not resolve default branch for ${owner}/${repo}; falling back to main/master guesses: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return undefined;
  }
}

const MAX_CONTENT_SIZE = 100_000;

function truncate(body: string): string {
  return body.length > MAX_CONTENT_SIZE
    ? body.slice(0, MAX_CONTENT_SIZE)
    : body;
}

/** Converts a GitHub blob URL to its raw-content equivalent, or null if the URL isn't a blob URL. */
export function convertGitHubUrlToRaw(url: string): string | null {
  const match = url.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/,
  );
  if (!match) {
    return null;
  }
  const [, owner, repo, path] = match;
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${path}`;
}

/**
 * Fetches README.md from a specific branch's raw content. Never throws for
 * an ordinary miss (404, network hiccup) — returns undefined so callers can
 * try the next candidate branch. raw.githubusercontent.com is a separate
 * surface from api.github.com and is not subject to the same rate limit, so
 * this is safe to try even when the default-branch API call was itself
 * rate-limited.
 */
export async function fetchReadmeForBranch(
  owner: string,
  repo: string,
  branch: string,
): Promise<string | undefined> {
  // Encode each path segment separately: a branch name like "release/2.0"
  // contains a literal slash that's part of the path, not a character to
  // percent-encode — encoding the whole string turns it into "release%2F2.0"
  // and raw.githubusercontent.com 404s on the mangled path.
  const encodedBranch = branch
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const readmeUrl = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodedBranch}/README.md`;
  try {
    const response = await safeGet<string>(readmeUrl);
    return response.status === 200 ? truncate(response.data) : undefined;
  } catch (error) {
    // swallow: caller tries the next branch candidate
    logger.debug(
      `No README for ${owner}/${repo}@${branch}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return undefined;
  }
}

export interface GithubFetchResult {
  body: string;
  isFunctional: boolean;
}

export interface GithubFetchLogContext {
  assignmentId?: number;
  questionId?: number;
}

interface GithubRepoMetadata {
  full_name?: string;
  description?: string;
  stargazers_count?: number;
  forks_count?: number;
  language?: string;
  updated_at?: string;
}

function formatRepoMetadataSummary(metadata: GithubRepoMetadata): string {
  return `Repository: ${metadata.full_name}\nDescription: ${
    metadata.description || "No description"
  }\nStars: ${metadata.stargazers_count}\nForks: ${
    metadata.forks_count
  }\nLanguage: ${metadata.language || "Not specified"}\nLast Updated: ${
    metadata.updated_at
  }`;
}

async function fetchRepoMetadataSummary(
  owner: string,
  repo: string,
): Promise<string | undefined> {
  const requestUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const metadata = await githubApiGet<GithubRepoMetadata>(
    requestUrl,
    owner,
    repo,
  );
  return formatRepoMetadataSummary(metadata);
}

function stripNoiseNodes($: ReturnType<typeof cheerio.load>): void {
  $("script, style, noscript, iframe, noembed, embed, object").remove();
}

/** DOM-scrape fallback for a GitHub page (repo root or otherwise). Last resort, unchanged selectors from the pre-existing implementation. */
async function scrapeGithubPage(url: string): Promise<string | undefined> {
  try {
    const response = await safeGet<string>(url);
    const $ = cheerio.load(response.data);
    stripNoiseNodes($);

    let content = "";
    const readmeElement = $("article.markdown-body");
    if (readmeElement.length > 0) {
      content = readmeElement.text().trim();
    } else {
      const aboutSection = $(".Box-body");
      if (aboutSection.length > 0) {
        content += `${aboutSection.text().trim()}\n\n`;
      }

      const fileList = $(
        "div.js-details-container div.js-navigation-container tr.js-navigation-item",
      );
      if (fileList.length > 0) {
        content += "Repository Files:\n";
        fileList.each((_index, element) => {
          const fileName = $(element).find(".js-navigation-open").text().trim();
          if (fileName) {
            content += `- ${fileName}\n`;
          }
        });
      }
    }

    return content ? content.replaceAll(/\s+/g, " ").trim() : undefined;
  } catch (error) {
    logger.warn(
      `GitHub HTML-scrape fallback failed for ${url}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return undefined;
  }
}

async function fetchGithubBlobContent(
  rawUrl: string,
): Promise<GithubFetchResult> {
  try {
    const response = await safeGet<string>(rawUrl);
    if (response.status === 200) {
      return { body: truncate(response.data), isFunctional: true };
    }
    return { body: "", isFunctional: false };
  } catch (error) {
    logger.warn(
      `Failed to fetch GitHub blob raw content from ${rawUrl}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { body: "", isFunctional: false };
  }
}

const REPO_ROOT_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/;

async function fetchGithubRepoRootContent(
  url: string,
  owner: string,
  repo: string,
): Promise<GithubFetchResult> {
  let rateLimitError: GithubRateLimitedError | undefined;
  let defaultBranch: string | undefined;

  try {
    defaultBranch = await resolveGithubDefaultBranch(owner, repo);
  } catch (error) {
    if (!(error instanceof GithubRateLimitedError)) {
      throw error;
    }
    rateLimitError = error;
  }

  const candidateBranches = defaultBranch
    ? [defaultBranch]
    : ["main", "master"];

  for (const branch of candidateBranches) {
    const body = await fetchReadmeForBranch(owner, repo, branch);
    if (body) {
      return { body, isFunctional: true };
    }
  }

  if (rateLimitError) {
    // Already know the api.github.com surface is exhausted — skip straight
    // to the retryable failure instead of burning another call on the
    // metadata fallback below. Rethrow the error caught above rather than
    // constructing a new one, so resetAt/retryAfterSeconds (populated from
    // the actual response headers) survive to the caller instead of coming
    // back undefined.
    throw rateLimitError;
  }

  try {
    const summary = await fetchRepoMetadataSummary(owner, repo);
    if (summary) {
      return { body: summary, isFunctional: true };
    }
  } catch (error) {
    if (error instanceof GithubRateLimitedError) {
      throw error;
    }
    logger.warn(
      `GitHub repository metadata fallback failed for ${owner}/${repo}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const scraped = await scrapeGithubPage(url);
  return scraped
    ? { body: scraped, isFunctional: true }
    : { body: "", isFunctional: false };
}

async function scrapeGenericUrl(url: string): Promise<GithubFetchResult> {
  try {
    const response = await safeGet<string>(url);
    const $ = cheerio.load(response.data);
    stripNoiseNodes($);
    const plainText = $("body").text().trim().replaceAll(/\s+/g, " ");
    return { body: plainText, isFunctional: true };
  } catch (error) {
    logger.warn(
      `Failed to fetch non-GitHub URL for grading: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { body: "", isFunctional: false };
  }
}

/**
 * Routes a learner-submitted URL to the right fetch strategy: GitHub blob
 * URLs are converted to their raw form; GitHub repo-root URLs resolve the
 * real default branch before guessing main/master, with an authenticated
 * metadata fallback and a DOM-scrape last resort; any other GitHub page is
 * scraped directly; any non-GitHub URL is scraped as plain text. Pure
 * routing/fetch logic — entry/outcome logging lives in the exported
 * `fetchUrlContentForGrading` wrapper below.
 */
async function dispatchUrlContentFetch(
  url: string,
): Promise<GithubFetchResult> {
  if (!url.includes("github.com")) {
    return scrapeGenericUrl(url);
  }

  if (url.includes("/blob/")) {
    const rawUrl = convertGitHubUrlToRaw(url);
    if (!rawUrl) {
      return { body: "", isFunctional: false };
    }
    return fetchGithubBlobContent(rawUrl);
  }

  const repoMatch = url.match(REPO_ROOT_RE);
  if (repoMatch) {
    const [, owner, repo] = repoMatch;
    return fetchGithubRepoRootContent(url, owner, repo);
  }

  // A github.com URL that's neither a blob nor a bare repo root (an issue,
  // PR, or directory listing) — scrape it directly, unchanged from the
  // pre-existing behavior.
  const scraped = await scrapeGithubPage(url);
  return scraped
    ? { body: scraped, isFunctional: true }
    : { body: "", isFunctional: false };
}

const GITHUB_OWNER_REPO_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)/;

/** Best-effort owner/repo extraction for log context only — never gates fetch behavior. */
function extractOwnerRepoForLogging(url: string): {
  owner?: string;
  repo?: string;
} {
  const match = url.match(GITHUB_OWNER_REPO_RE);
  return match ? { owner: match[1], repo: match[2] } : {};
}

function buildLogContextSuffix(
  url: string,
  logContext: GithubFetchLogContext,
): string {
  const { owner, repo } = extractOwnerRepoForLogging(url);
  const parts = [
    `url=${url}`,
    owner ? `owner=${owner}` : undefined,
    repo ? `repo=${repo}` : undefined,
    `assignmentId=${logContext.assignmentId ?? "unknown"}`,
    `questionId=${logContext.questionId ?? "unknown"}`,
  ].filter(Boolean);
  return parts.join(", ");
}

/**
 * Fetches gradeable content from a learner-submitted URL. This is the single
 * entry point for the three call sites that used to hand-roll this pipeline
 * independently — see the module doc comment at the top of this file.
 *
 * Owns entry/outcome structured logging for the whole pipeline (url, best-
 * effort owner/repo, assignmentId/questionId as supplied by the caller).
 * Never logs tokens or fetched content bodies. The individual fetch/scrape
 * helpers above additionally log their own narrower misses (rate limits,
 * branch-resolution failures, per-branch README misses) — this wrapper adds
 * the top-level entry and final outcome the caller needs for correlating a
 * grading failure back to an assignment/question.
 *
 * Throws GithubRateLimitedError when the api.github.com surface is
 * exhausted and no README guess landed — callers must NOT swallow this into
 * a 0-point "invalid URL" response; it is a retryable system failure, not a
 * problem with the learner's submission (see the error class doc comment).
 */
export async function fetchUrlContentForGrading(
  url: string,
  logContext?: GithubFetchLogContext,
): Promise<GithubFetchResult> {
  const resolvedLogContext = logContext ?? {};
  const logSuffix = buildLogContextSuffix(url, resolvedLogContext);

  logger.debug(`Fetching URL content for grading (${logSuffix})`);

  try {
    const result = await dispatchUrlContentFetch(url);
    if (result.isFunctional) {
      logger.debug(`URL content fetch succeeded (${logSuffix})`);
    } else {
      logger.warn(
        `URL content fetch returned no functional content (${logSuffix})`,
      );
    }
    return result;
  } catch (error) {
    // Re-thrown deliberately: GithubRateLimitedError (the only expected
    // throw here) must propagate to the caller as a retryable failure, not
    // be swallowed into a graded-0 outcome. This is the outcome log for that
    // path.
    logger.warn(
      `URL content fetch failed with a retryable error (${logSuffix}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    throw error;
  }
}
