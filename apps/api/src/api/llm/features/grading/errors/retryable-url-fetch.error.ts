/**
 * Base class for "we could not read the learner's URL right now, but the URL
 * itself is fine" failures raised while fetching a submitted link for grading.
 *
 * Why it exists: the blob-content fetch used to collapse a 429, a read
 * timeout, and a connection reset into the same `isFunctional: false` the
 * grader uses for a confirmed 404, which awarded a hard zero for content the
 * server could read moments earlier or later. Anything transient now throws
 * one of these instead, so the job worker's retry policy gets a chance and the
 * learner never receives a fabricated zero.
 *
 * Deliberately does NOT extend LearnerFacingGradingError: this is a system
 * fault, not something the learner did wrong. See apps/jobs
 * job-worker.service.ts `classifyAttemptError` — anything that is neither a
 * LearnerFacingGradingError nor in TERMINAL_GRADING_ERROR_NAMES is rethrown
 * untouched and picked up by BullMQ's normal retry policy.
 *
 * Fields are own enumerable properties so the project logger can serialize
 * them as structured context.
 */
export interface RetryableUrlFetchErrorFields {
  /** The URL that could not be read. Never a token-bearing URL. */
  requestUrl: string;
  /** Short machine-readable cause, e.g. "timeout", "connection_reset", "server_error". */
  reason: string;
  /** Upstream status code when the failure carried one. */
  status?: number;
}

export class RetryableUrlFetchError extends Error {
  public readonly requestUrl: string;
  public readonly reason: string;
  public readonly status?: number;

  constructor(fields: RetryableUrlFetchErrorFields, message?: string) {
    super(
      message ??
        `Temporarily unable to read ${fields.requestUrl} for grading (${fields.reason}). This is a transient fetch failure, not a problem with the submitted URL.`,
    );
    this.name = "RetryableUrlFetchError";
    this.requestUrl = fields.requestUrl;
    this.reason = fields.reason;
    this.status = fields.status;

    // Restore the prototype chain when extending a built-in, so `instanceof`
    // works correctly under the project's TypeScript compile target.
    Object.setPrototypeOf(this, RetryableUrlFetchError.prototype);
  }
}
