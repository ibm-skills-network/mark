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
