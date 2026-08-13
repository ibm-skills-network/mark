/**
 * Thrown when a GitHub API call made while fetching a learner's submitted
 * URL for grading (README lookup, default-branch resolution, or repository
 * metadata) is rejected because the server's GitHub API rate limit has been
 * exhausted. Deliberately does NOT extend LearnerFacingGradingError: this is
 * a transient system fault, not something the learner did wrong, so the job
 * worker must treat it as retryable. See apps/jobs job-worker.service.ts
 * classifyAttemptError — anything that is not a LearnerFacingGradingError
 * and not in TERMINAL_GRADING_ERROR_NAMES is rethrown untouched and picked
 * up by BullMQ's normal retry policy.
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

export class GithubRateLimitedError extends Error {
  public readonly owner: string;
  public readonly repo: string;
  public readonly requestUrl: string;
  public readonly resetAt?: number;
  public readonly retryAfterSeconds?: number;

  constructor(fields: GithubRateLimitedErrorFields) {
    super(
      `GitHub API rate limit exceeded while fetching ${fields.owner}/${fields.repo} for grading. This is a temporary system limit, not a problem with the submitted URL.`,
    );
    this.name = "GithubRateLimitedError";
    this.owner = fields.owner;
    this.repo = fields.repo;
    this.requestUrl = fields.requestUrl;
    this.resetAt = fields.resetAt;
    this.retryAfterSeconds = fields.retryAfterSeconds;

    // Restore the prototype chain when extending a built-in, so `instanceof`
    // works correctly under the project's TypeScript compile target.
    Object.setPrototypeOf(this, GithubRateLimitedError.prototype);
  }
}
