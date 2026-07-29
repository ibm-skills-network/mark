/**
 * Pure helpers for detecting a GitHub API rate-limit response and pulling
 * the retry-timing hints out of its headers. Kept separate from the fetch
 * orchestration so the detection logic is unit-testable without mocking any
 * HTTP call.
 */

export interface GithubRateLimitInfo {
  resetAt?: number;
  retryAfterSeconds?: number;
}

function normalizeHeaders(
  headers: Record<string, unknown> | undefined,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  if (!headers) return normalized;
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      normalized[key.toLowerCase()] = value;
    }
  }
  return normalized;
}

function parseIntHeader(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * True when a response looks like a GitHub primary or secondary rate-limit
 * rejection: a 403 or 429 with `x-ratelimit-remaining: 0`, or a 403 or 429
 * carrying a `retry-after` header (the secondary/abuse-detection limit,
 * which does not always report ratelimit-remaining; GitHub documents this
 * limit as returning either status).
 */
export function isGithubRateLimitResponse(
  status: number,
  headers: Record<string, unknown> | undefined,
): boolean {
  if (status !== 403 && status !== 429) {
    return false;
  }
  const normalized = normalizeHeaders(headers);
  if (normalized["x-ratelimit-remaining"] === "0") {
    return true;
  }
  return "retry-after" in normalized;
}

/** Extracts retry-timing hints from a rate-limited response's headers. */
export function parseGithubRateLimitInfo(
  headers: Record<string, unknown> | undefined,
): GithubRateLimitInfo {
  const normalized = normalizeHeaders(headers);
  return {
    resetAt: parseIntHeader(normalized["x-ratelimit-reset"]),
    retryAfterSeconds: parseIntHeader(normalized["retry-after"]),
  };
}
