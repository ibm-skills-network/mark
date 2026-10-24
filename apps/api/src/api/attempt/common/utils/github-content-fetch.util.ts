import { Logger } from "@nestjs/common";
import * as cheerio from "cheerio";
import { GithubRateLimitedError } from "src/api/llm/features/grading/errors/github-rate-limited.error";
import { RetryableUrlFetchError } from "src/api/llm/features/grading/errors/retryable-url-fetch.error";
import { getGithubGradingApiToken } from "src/config/github-grading-token";
import {
  isGithubRateLimitResponse,
  parseGithubRateLimitInfo,
} from "./github-rate-limit-detection.util";
import { isMeshConnectRefused, safeGet } from "./ssrf-safe-http";

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

  const token = await getGithubGradingApiToken();
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
    throwIfRetryable(error, requestUrl, "github_api");
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
 * comment above). Confirmed misses return undefined; transient failures retain
 * their retryable error so callers can try another content source before retrying.
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
    if (error instanceof RetryableUrlFetchError) {
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
 * a confirmed miss (404) — returns undefined so callers can
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
    const response = await safeGet<string>(readmeUrl, {
      responseType: "text",
    });
    return response.status === 200 ? truncate(response.data) : undefined;
  } catch (error) {
    throwIfRetryable(error, readmeUrl, "readme");
    logger.debug(
      `No README for ${owner}/${repo}@${branch}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return undefined;
  }
}

/** Why a fetch produced nothing gradeable, in the learner-facing vocabulary. */
export type UrlFetchFailureCode =
  | "url_unreachable"
  | "url_blocked"
  | "url_empty"
  | "url_unsupported";

export interface UrlFetchFailure {
  code: UrlFetchFailureCode;
  /** Status the remote site answered with, when it answered at all. */
  httpStatus?: number;
}

export interface GithubFetchResult {
  /** Root-repository fallbacks do not establish implementation evidence. */
  evidenceKind?: "readme" | "repository_metadata" | "repository_page";
  body: string;
  isFunctional: boolean;
  /** Set whenever the result has nothing gradeable in it. */
  failure?: UrlFetchFailure;
}

function httpStatusOf(error: unknown): number | undefined {
  const status = (error as { response?: { status?: unknown } } | undefined)
    ?.response?.status;
  return typeof status === "number" ? status : undefined;
}

/**
 * Maps a confirmed (non-retryable) miss to what the learner should be told.
 * 401/403/406/451 are a site refusing automated readers; everything else that
 * answered is treated as "not found", which for GitHub includes private repos.
 */
function failureForConfirmedMiss(error: unknown): UrlFetchFailure {
  // The mesh's own 504 for a refused connect is not the site's answer.
  if (isMeshConnectRefused(error)) return { code: "url_unreachable" };
  const httpStatus = httpStatusOf(error);
  if (
    httpStatus === 401 ||
    httpStatus === 403 ||
    httpStatus === 406 ||
    httpStatus === 451
  ) {
    return { code: "url_blocked", httpStatus };
  }
  return httpStatus === undefined
    ? { code: "url_unreachable" }
    : { code: "url_unreachable", httpStatus };
}

function emptyResult(failure: UrlFetchFailure): GithubFetchResult {
  return { body: "", isFunctional: false, failure };
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
async function scrapeGithubPage(
  url: string,
  requireReadme = false,
  onMiss?: (failure: UrlFetchFailure) => void,
): Promise<string | undefined> {
  try {
    const response = await safeGet<string>(url, {
      headers: BROWSER_LIKE_HEADERS,
    });
    const $ = cheerio.load(response.data);
    stripNoiseNodes($);

    let content = "";
    const readmeElement = $("article.markdown-body");
    if (readmeElement.length > 0) {
      content = readmeElement.text().trim();
    } else if (!requireReadme) {
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
    throwIfRetryable(error, url, "github_page");
    onMiss?.(failureForConfirmedMiss(error));
    logger.warn(
      `GitHub HTML-scrape fallback failed for ${url}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return undefined;
  }
}

/**
 * Classifies a failed learner-URL fetch as transient or confirmed.
 *
 * `isFunctional: false` means "the grader read the URL and there is nothing
 * gradeable there" — a hard zero the learner can act on. A rate limit, a read
 * timeout, a reset connection or a 5xx means the opposite: the content may be
 * perfectly good and we simply could not see it this time. Collapsing the two
 * is what awarded zeros for links that succeeded minutes earlier, so anything
 * transient is raised as a retryable error and left to the job's retry policy.
 *
 * DNS and connection-refused failures are treated as confirmed: a host that
 * does not resolve will not resolve on a retry either, and retrying would turn
 * a graded zero into a failed attempt. That includes a mesh-generated 504 for
 * a refused connect, which looks like a 5xx but is not the origin's answer.
 */
function classifyFetchFailure(error: unknown): {
  retryable: boolean;
  reason: string;
  status?: number;
  rateLimited: boolean;
  headers?: Record<string, unknown>;
} {
  const response = (
    error as {
      response?: { status?: number; headers?: Record<string, unknown> };
    }
  )?.response;
  const status =
    typeof response?.status === "number" ? response.status : undefined;

  if (
    status !== undefined &&
    isGithubRateLimitResponse(status, response?.headers)
  ) {
    return {
      retryable: true,
      reason: "rate_limited",
      status,
      rateLimited: true,
      headers: response?.headers,
    };
  }
  if (status === 429) {
    return {
      retryable: true,
      reason: "rate_limited",
      status,
      rateLimited: true,
      headers: response?.headers,
    };
  }
  // A 504 synthesised by the service mesh because the connect itself was
  // refused (e.g. cluster egress does not allow port 80) is the same failure
  // as ECONNREFUSED: it will not change on a retry.
  if (isMeshConnectRefused(error)) {
    return {
      retryable: false,
      reason: "connect_refused",
      status,
      rateLimited: false,
    };
  }
  if (status !== undefined && status >= 500) {
    return {
      retryable: true,
      reason: "server_error",
      status,
      rateLimited: false,
    };
  }
  if (status !== undefined) {
    return {
      retryable: false,
      reason: "http_error",
      status,
      rateLimited: false,
    };
  }

  const rawCode = (error as { code?: unknown })?.code;
  const code = typeof rawCode === "string" ? rawCode : undefined;
  if (code && TRANSIENT_NETWORK_CODES.has(code)) {
    return {
      retryable: true,
      reason:
        code === "ECONNABORTED" || code === "ETIMEDOUT"
          ? "timeout"
          : "connection_reset",
      rateLimited: false,
    };
  }
  if (code && CONFIRMED_NETWORK_CODES.has(code)) {
    return { retryable: false, reason: code, rateLimited: false };
  }
  return { retryable: false, reason: code ?? "unknown", rateLimited: false };
}

/** Codes that mean "try again", not "this URL has nothing to grade". */
const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNABORTED",
  "ETIMEDOUT",
  "ECONNRESET",
  "EPIPE",
  "EAI_AGAIN",
  "ERR_SOCKET_CONNECTION_TIMEOUT",
]);

/** Codes that will fail the same way on every retry. */
const CONFIRMED_NETWORK_CODES = new Set([
  "ENOTFOUND",
  "EAI_NONAME",
  "ECONNREFUSED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_HAS_EXPIRED",
]);

/**
 * Turns a transient failure into the typed retryable error, or returns so the
 * caller can report a confirmed miss as unreadable content.
 */
function throwIfRetryable(
  error: unknown,
  requestUrl: string,
  logSuffix: string,
): void {
  const classification = classifyFetchFailure(error);
  if (!classification.retryable) {
    return;
  }
  if (classification.rateLimited) {
    const { owner, repo } = extractOwnerRepoForLogging(requestUrl);
    const { resetAt, retryAfterSeconds } = parseGithubRateLimitInfo(
      classification.headers,
    );
    logger.warn(
      `Rate limited while fetching learner URL content (${logSuffix}, resetAt=${resetAt ?? "unknown"})`,
    );
    throw new GithubRateLimitedError({
      owner: owner ?? "unknown",
      repo: repo ?? "unknown",
      requestUrl,
      resetAt,
      retryAfterSeconds,
    });
  }
  logger.warn(
    `Transient failure fetching learner URL content (${logSuffix}, reason=${classification.reason}, status=${classification.status ?? "none"})`,
  );
  throw new RetryableUrlFetchError({
    requestUrl,
    reason: classification.reason,
    status: classification.status,
  });
}

async function fetchGithubBlobContent(
  rawUrl: string,
): Promise<GithubFetchResult> {
  try {
    // Otherwise Axios parses JSON and notebooks into objects.
    const response = await safeGet<string>(rawUrl, {
      responseType: "text",
    });
    if (response.status === 200) {
      const body = truncate(response.data);
      return body.trim()
        ? { body, isFunctional: true }
        : emptyResult({ code: "url_empty", httpStatus: 200 });
    }
    if (response.status >= 500) {
      logger.warn(
        `GitHub blob raw content returned ${response.status} for ${rawUrl}; treating as retryable`,
      );
      throw new RetryableUrlFetchError({
        requestUrl: rawUrl,
        reason: "server_error",
        status: response.status,
      });
    }
    return emptyResult({
      code: "url_unreachable",
      httpStatus: response.status,
    });
  } catch (error) {
    if (error instanceof RetryableUrlFetchError) {
      throw error;
    }
    throwIfRetryable(error, rawUrl, `url=${rawUrl}`);
    logger.warn(
      `Failed to fetch GitHub blob raw content from ${rawUrl}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return emptyResult(failureForConfirmedMiss(error));
  }
}

const GITHUB_TREE_RE =
  /^https:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/tree\/([^#?]+)/i;

/** Bounds for reading a folder: enough for a module, never a whole repo. */
export const MAX_FOLDER_FILES = 25;
const MAX_FOLDER_FILE_BYTES = 60_000;
const FOLDER_FETCH_CONCURRENCY = 5;

// Content we cannot show a text grader; listed by name only.
const BINARY_EXTENSIONS = new Set([
  "7z",
  "avi",
  "bin",
  "bmp",
  "class",
  "dll",
  "doc",
  "docx",
  "exe",
  "gif",
  "gz",
  "ico",
  "jar",
  "jpeg",
  "jpg",
  "mov",
  "mp3",
  "mp4",
  "o",
  "pdf",
  "png",
  "ppt",
  "pptx",
  "pyc",
  "so",
  "sqlite",
  "tar",
  "tgz",
  "ttf",
  "wav",
  "webp",
  "woff",
  "woff2",
  "xls",
  "xlsx",
  "zip",
]);

interface GithubContentEntry {
  type?: string;
  name?: string;
  path?: string;
  size?: number;
  download_url?: string | null;
  content?: string;
  encoding?: string;
}

function decodePathSegments(path: string): string[] {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        // A literal "%" in a file name: use the segment as typed.
        return segment;
      }
    });
}

function contentsApiUrl(
  owner: string,
  repo: string,
  path: string[],
  reference: string,
): string {
  const encodedPath = path.map((part) => encodeURIComponent(part)).join("/");
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}?ref=${encodeURIComponent(reference)}`;
}

function isBinaryName(name: string): boolean {
  const extension = name.includes(".")
    ? (name.split(".").pop() ?? "").toLowerCase()
    : "";
  return BINARY_EXTENSIONS.has(extension);
}

async function fetchFolderFile(
  entry: GithubContentEntry,
): Promise<string | undefined> {
  if (!entry.download_url) return undefined;
  // download_url is GitHub's own raw host; keep it that way before fetching.
  let host: string;
  try {
    host = new URL(entry.download_url).hostname;
  } catch {
    return undefined;
  }
  if (host !== "raw.githubusercontent.com") return undefined;
  try {
    const response = await safeGet<string>(entry.download_url, {
      responseType: "text",
    });
    if (response.status !== 200 || typeof response.data !== "string") {
      return undefined;
    }
    if (response.data.includes("\u0000")) return undefined;
    return response.data.slice(0, MAX_FOLDER_FILE_BYTES);
  } catch (error) {
    throwIfRetryable(error, entry.download_url, "folder_file");
    logger.warn(
      `Could not read a file inside a GitHub folder (path=${entry.path ?? "unknown"}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return undefined;
  }
}

/**
 * Reads a GitHub folder (`/tree/<ref>/<path>`) through the contents API. The
 * HTML folder page is rendered client-side now, so scraping it yields
 * nothing. Lists every entry, then inlines up to MAX_FOLDER_FILES text files
 * under the overall content cap; sub-folders are listed, not walked.
 */
async function fetchGithubFolderContent(
  owner: string,
  repoSegment: string,
  rest: string,
): Promise<GithubFetchResult> {
  const repo = repoSegment.replace(/\.git$/i, "");
  const segments = decodePathSegments(rest);
  if (segments.length === 0) return emptyResult({ code: "url_unsupported" });

  // A branch name can contain "/", so the ref/path split is ambiguous; try
  // the common one-segment ref first, then a two-segment ref.
  const candidates: Array<{ ref: string; path: string[] }> = [
    { ref: segments[0], path: segments.slice(1) },
  ];
  if (segments.length > 1) {
    candidates.push({
      ref: segments.slice(0, 2).join("/"),
      path: segments.slice(2),
    });
  }

  let listing: GithubContentEntry[] | GithubContentEntry | undefined;
  let chosen = candidates[0];
  let miss: UrlFetchFailure = { code: "url_unreachable", httpStatus: 404 };
  for (const candidate of candidates) {
    const requestUrl = contentsApiUrl(
      owner,
      repo,
      candidate.path,
      candidate.ref,
    );
    try {
      listing = await githubApiGet<GithubContentEntry[] | GithubContentEntry>(
        requestUrl,
        owner,
        repo,
      );
      chosen = candidate;
      break;
    } catch (error) {
      if (error instanceof RetryableUrlFetchError) throw error;
      miss = failureForConfirmedMiss(error);
      // Only a 404 can mean "wrong ref split"; anything else is the answer.
      if (httpStatusOf(error) !== 404) break;
    }
  }
  if (!listing) {
    logger.warn(
      `GitHub folder could not be listed for ${owner}/${repo} (status=${miss.httpStatus ?? "none"})`,
    );
    return emptyResult(miss);
  }

  const label = `${owner}/${repo}/${chosen.path.join("/")}`.replace(/\/$/, "");
  // A /tree/ link to a single file comes back as one entry, not a list.
  if (!Array.isArray(listing)) {
    if (
      listing.type === "file" &&
      listing.encoding === "base64" &&
      listing.content
    ) {
      const text = Buffer.from(listing.content, "base64").toString("utf8");
      return text.trim()
        ? { body: truncate(text), isFunctional: true }
        : emptyResult({ code: "url_empty", httpStatus: 200 });
    }
    const text = await fetchFolderFile(listing);
    return text?.trim()
      ? { body: truncate(text), isFunctional: true }
      : emptyResult({ code: "url_empty", httpStatus: 200 });
  }

  if (listing.length === 0) {
    return emptyResult({ code: "url_empty", httpStatus: 200 });
  }

  const sorted = [...listing].sort((a, b) =>
    (a.path ?? "").localeCompare(b.path ?? ""),
  );
  const readable = sorted
    .filter(
      (entry) =>
        entry.type === "file" &&
        entry.name &&
        !isBinaryName(entry.name) &&
        (entry.size ?? 0) <= MAX_FOLDER_FILE_BYTES * 4,
    )
    .slice(0, MAX_FOLDER_FILES);

  const contents = new Map<string, string>();
  let budget = MAX_CONTENT_SIZE;
  for (
    let index = 0;
    index < readable.length && budget > 0;
    index += FOLDER_FETCH_CONCURRENCY
  ) {
    const batch = readable.slice(index, index + FOLDER_FETCH_CONCURRENCY);
    const texts = await Promise.all(
      batch.map((entry) => fetchFolderFile(entry)),
    );
    for (const [position, text] of texts.entries()) {
      if (!text || budget <= 0) continue;
      const kept = text.slice(0, budget);
      budget -= kept.length;
      contents.set(batch[position].path ?? batch[position].name ?? "", kept);
    }
  }

  const listingLines = sorted.map(
    (entry) => `- ${entry.name ?? "?"}${entry.type === "dir" ? "/" : ""}`,
  );
  const sections = [...contents.entries()].map(
    ([path, text]) => `=== ${path} ===\n${text}`,
  );
  if (sections.length === 0) {
    logger.warn(
      `GitHub folder ${label} has no readable text files (${sorted.length} entries)`,
    );
    return emptyResult({ code: "url_empty", httpStatus: 200 });
  }
  const body = [
    `Folder: ${label} (ref ${chosen.ref})`,
    "Contents:",
    ...listingLines,
    "",
    ...sections,
  ].join("\n");
  return { body: truncate(body), isFunctional: true };
}

// The clone address (".git") names the same repository as the page.
const REPO_ROOT_RE =
  /^https:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i;

async function fetchGithubRepoRootContent(
  url: string,
  owner: string,
  repo: string,
): Promise<GithubFetchResult> {
  let transientError: RetryableUrlFetchError | undefined;
  let defaultBranch: string | undefined;

  try {
    defaultBranch = await resolveGithubDefaultBranch(owner, repo);
  } catch (error) {
    if (!(error instanceof RetryableUrlFetchError)) throw error;
    transientError = error;
  }

  const candidateBranches = defaultBranch
    ? [defaultBranch]
    : ["main", "master"];
  for (const branch of candidateBranches) {
    try {
      const body = await fetchReadmeForBranch(owner, repo, branch);
      if (body) return { body, isFunctional: true, evidenceKind: "readme" };
    } catch (error) {
      if (!(error instanceof RetryableUrlFetchError)) throw error;
      transientError ??= error;
    }
  }

  // Preserve the provider's retry timing and avoid another call to an
  // exhausted API. Raw README guesses above use a separate surface.
  if (transientError instanceof GithubRateLimitedError) throw transientError;

  // Metadata alone cannot replace a README we failed to read temporarily.
  if (!transientError) {
    try {
      const summary = await fetchRepoMetadataSummary(owner, repo);
      if (summary)
        return {
          body: summary,
          isFunctional: true,
          evidenceKind: "repository_metadata",
        };
    } catch (error) {
      if (error instanceof GithubRateLimitedError) throw error;
      if (error instanceof RetryableUrlFetchError) transientError = error;
      else
        logger.warn(
          `GitHub repository metadata fallback failed for ${owner}/${repo}`,
        );
    }
  }

  let pageMiss: UrlFetchFailure | undefined;
  try {
    const scraped = await scrapeGithubPage(
      url,
      Boolean(transientError),
      (failure) => {
        pageMiss = failure;
      },
    );
    if (scraped)
      return {
        body: scraped,
        isFunctional: true,
        evidenceKind: "repository_page",
      };
  } catch (error) {
    if (!(error instanceof RetryableUrlFetchError)) throw error;
    transientError ??= error;
  }
  if (transientError) throw transientError;
  // GitHub answers 404 for a private repository as well as a missing one.
  return emptyResult(pageMiss ?? { code: "url_empty", httpStatus: 200 });
}

function isHtmlResponse(contentType: unknown, body: string): boolean {
  const mediaType =
    typeof contentType === "string"
      ? contentType.split(";")[0].trim().toLowerCase()
      : "";
  if (mediaType) {
    return mediaType === "text/html" || mediaType === "application/xhtml+xml";
  }
  // Without a declared type, require an HTML document or common page tag;
  // arbitrary angle brackets in source code are not evidence of HTML.
  return /<!doctype\s+html\b|<\/?(?:html|body|p|div)(?=[\s/>])/i.test(body);
}

/**
 * Headers for reading a learner's page the way a browser would. axios' default
 * `Accept: application/json, text/plain, *\/*` gets a 406 from sites that
 * negotiate on it, and some sites refuse requests with no browser-like agent.
 */
const BROWSER_LIKE_HEADERS: Record<string, string> = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (compatible; MarkGrader/1.0; +https://skills.network) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
};

async function scrapeGenericUrl(url: string): Promise<GithubFetchResult> {
  try {
    const response = await safeGet<string>(url, {
      responseType: "text",
      headers: BROWSER_LIKE_HEADERS,
    });
    // The HTML parser would eat code such as `List<Order>` in raw files.
    if (!isHtmlResponse(response.headers?.["content-type"], response.data)) {
      const body = truncate(response.data);
      return body.trim()
        ? { body, isFunctional: true }
        : emptyResult({ code: "url_empty", httpStatus: response.status });
    }
    const $ = cheerio.load(response.data);
    stripNoiseNodes($);
    const plainText = truncate($("body").text().trim().replaceAll(/\s+/g, " "));
    return plainText
      ? { body: plainText, isFunctional: true }
      : emptyResult({ code: "url_empty", httpStatus: response.status });
  } catch (error) {
    // Same rule as the blob path: a timeout or a 5xx on a learner's own site
    // is a retry, not evidence that the page has nothing on it.
    throwIfRetryable(error, url, `url=${url}`);
    logger.warn(
      `Failed to fetch non-GitHub URL for grading: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return emptyResult(failureForConfirmedMiss(error));
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
      return emptyResult({ code: "url_unsupported" });
    }
    return fetchGithubBlobContent(rawUrl);
  }

  const treeMatch = url.match(GITHUB_TREE_RE);
  if (treeMatch) {
    const [, owner, repo, rest] = treeMatch;
    return fetchGithubFolderContent(owner, repo, rest);
  }

  const repoMatch = url.match(REPO_ROOT_RE);
  if (repoMatch) {
    const [, owner, repo] = repoMatch;
    return fetchGithubRepoRootContent(url, owner, repo);
  }

  // A github.com URL that's neither a blob, a folder nor a bare repo root (an
  // issue, a PR, a gist) — scrape it directly.
  let pageMiss: UrlFetchFailure | undefined;
  const scraped = await scrapeGithubPage(url, false, (failure) => {
    pageMiss = failure;
  });
  return scraped
    ? { body: scraped, isFunctional: true }
    : emptyResult(pageMiss ?? { code: "url_empty", httpStatus: 200 });
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

function hostForLog(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    // Log context only; an unparseable URL has no host to report.
    return "unknown";
  }
}

const MAX_LOGGED_URL_LENGTH = 300;

function buildLogContextSuffix(
  url: string,
  logContext: GithubFetchLogContext,
): string {
  const { owner, repo } = extractOwnerRepoForLogging(url);
  const parts = [
    `url=${url.slice(0, MAX_LOGGED_URL_LENGTH)}`,
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
 * Throws a RetryableUrlFetchError (GithubRateLimitedError when a rate limit
 * is the cause) whenever the failure is transient — an exhausted
 * api.github.com budget with no README guess left, a read timeout, a reset
 * connection, or a 5xx. Callers must NOT swallow these into a 0-point
 * response; they are retryable system failures, not a problem with the
 * learner's submission (see the error class doc comments). A confirmed miss
 * — a 404/410, a host that does not resolve — still comes back as
 * `isFunctional: false` so grading can award a zero with an explanation.
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
    const hasBody =
      typeof result.body === "string"
        ? result.body.trim().length > 0
        : result.body != null;
    if (result.isFunctional && hasBody) {
      logger.debug(`URL content fetch succeeded (${logSuffix})`);
    } else {
      // Not debug: an empty fetch blocks grading, and the host + bounded URL
      // are what make that block traceable afterwards.
      logger.warn(
        `URL content fetch returned no gradeable content (host=${hostForLog(url)}, failure=${result.failure?.code ?? "url_empty"}, httpStatus=${result.failure?.httpStatus ?? "none"}, ${logSuffix})`,
      );
    }
    return result;
  } catch (error) {
    // Re-thrown deliberately: a RetryableUrlFetchError (the only expected
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
