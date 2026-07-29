import { Logger } from "@nestjs/common";
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
 * Resolves a GitHub repository's actual default branch via
 * `GET /repos/{owner}/{repo}`. Returns undefined (never throws, other than
 * GithubRateLimitedError) when the lookup fails for any other reason —
 * network hiccup, private/nonexistent repo, unexpected response shape — so
 * callers can fall back to guessing main/master exactly like before this
 * function existed.
 */
export async function resolveGithubDefaultBranch(
  owner: string,
  repo: string,
): Promise<string | undefined> {
  const requestUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  try {
    const data = await githubApiGet<GithubRepoDescriptor>(
      requestUrl,
      owner,
      repo,
    );
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
  const readmeUrl = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/README.md`;
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
