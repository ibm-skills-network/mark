import { RetryableUrlFetchError } from "./retryable-url-fetch.error";

/**
 * Thrown when a GitHub call made while fetching a learner's submitted URL for
 * grading (README lookup, default-branch resolution, repository metadata, or
 * the raw blob itself) is rejected because a rate limit has been exhausted.
 *
 * The retryable-fetch base class it extends is what callers should catch when
 * they only care that the failure is transient; catch this subclass when the
 * rate-limit specifics (owner/repo, reset time) matter.
 *
 * Fields are exposed as own enumerable properties so the project logger can
 * serialize them as structured context.
 */
export interface GithubRateLimitedErrorFields {
  owner: string;
  repo: string;
  requestUrl: string;
  /** Epoch seconds from the `x-ratelimit-reset` response header, when present. */
  resetAt?: number;
  /** Seconds from the `retry-after` response header (secondary/abuse-detection limits). */
  retryAfterSeconds?: number;
}

export class GithubRateLimitedError extends RetryableUrlFetchError {
  public readonly owner: string;
  public readonly repo: string;
  public readonly resetAt?: number;
  public readonly retryAfterSeconds?: number;

  constructor(fields: GithubRateLimitedErrorFields) {
    super(
      { requestUrl: fields.requestUrl, reason: "rate_limited" },
      `GitHub API rate limit exceeded while fetching ${fields.owner}/${fields.repo} for grading. This is a temporary system limit, not a problem with the submitted URL.`,
    );
    this.name = "GithubRateLimitedError";
    this.owner = fields.owner;
    this.repo = fields.repo;
    this.resetAt = fields.resetAt;
    this.retryAfterSeconds = fields.retryAfterSeconds;

    // Restore the prototype chain when extending a built-in, so `instanceof`
    // works correctly under the project's TypeScript compile target.
    Object.setPrototypeOf(this, GithubRateLimitedError.prototype);
  }
}
