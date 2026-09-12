import type { BackoffOptions } from "bullmq";
import { RetryableUrlFetchError } from "src/api/llm/features/grading/errors/retryable-url-fetch.error";
import { JOB_QUEUE_NAMES } from "./job-queue.constants";

/**
 * Retry pacing for the attempt-grading queues.
 *
 * The attempt queues run with `attempts: 3` and, historically, no backoff at
 * all: BullMQ re-ran a failed grade the instant it failed. That is the right
 * behaviour for a crashed worker or a lost database connection, and the wrong
 * one for the failure class that says "the thing we were reading was
 * momentarily unavailable" — a read timeout, a reset connection, a 5xx or an
 * exhausted API rate limit on a learner's submitted link. Three attempts fired
 * inside a second all hit the same exhausted budget, the attempt is then marked
 * terminally failed, and the learner is told grading is out of service.
 *
 * So the delay is decided per failure rather than per queue. BullMQ resolves a
 * job's backoff through a named strategy; this module owns the name, the job
 * option that references it, and the strategy body itself. Anything that is not
 * a transient URL fetch returns 0 — BullMQ's "retry immediately" — so no other
 * failure class changes pace.
 */

// Name of the custom strategy. Deliberately not one of BullMQ's built-ins
// ("fixed" / "exponential"): those apply one curve to every failure, which is
// precisely what must not happen here. Any worker draining a queue that
// carries this backoff type must register the strategy below, or BullMQ throws
// "Unknown backoff strategy" on the first retry.
export const ATTEMPT_RETRY_BACKOFF_TYPE = "attempt-transient-fetch";

export const ATTEMPT_RETRY_BACKOFF: BackoffOptions = {
  type: ATTEMPT_RETRY_BACKOFF_TYPE,
};

// First retry window. A transient upstream failure is rarely over in under a
// few seconds, and a GitHub secondary rate limit asks for at least a minute;
// 30s buys real time while keeping the worst case tolerable for a learner
// waiting on a grade.
export const RETRYABLE_FETCH_BASE_DELAY_MS = 30_000;

// Ceiling on any single wait, including one derived from a rate-limit header.
// A primary GitHub rate limit can reset up to an hour out, and holding a
// learner's grading modal open that long is worse than failing it — grading is
// user-visible work, not a background sync.
export const RETRYABLE_FETCH_MAX_DELAY_MS = 300_000;

// Fraction of each window that is randomised. The wait lands uniformly in
// [ceiling * (1 - jitter), ceiling], matching BullMQ's own jitter semantics.
// Without it, every attempt that failed against the same upstream at the same
// moment retries at the same moment, which is how a rate limit stays
// exhausted.
export const RETRYABLE_FETCH_JITTER = 0.5;

// Name-only fallback for the transient classes. `instanceof` covers the
// in-process case; a job forwarded to the API and back crosses a JSON boundary
// that keeps `name` and drops the prototype. Mirrors the name-set fallback the
// jobs worker already uses for terminal grading errors. Any new subclass of
// RetryableUrlFetchError belongs here too.
const RETRYABLE_FETCH_ERROR_NAMES = new Set([
  "RetryableUrlFetchError",
  "GithubRateLimitedError",
]);

export interface AttemptRetryBackoffOverrides {
  /** Randomness source. Injected by tests; production uses Math.random. */
  random?: () => number;
  /** Clock. Injected by tests; production uses Date.now. */
  now?: () => number;
}

/** True when the failure is a "read it again shortly" fetch failure. */
export function isRetryableUrlFetchFailure(error: unknown): boolean {
  if (error instanceof RetryableUrlFetchError) {
    return true;
  }
  return error instanceof Error && RETRYABLE_FETCH_ERROR_NAMES.has(error.name);
}

/** True when jobs on this queue carry the custom attempt backoff. */
export function queueUsesAttemptRetryBackoff(queueName: string): boolean {
  return (
    queueName === JOB_QUEUE_NAMES.ATTEMPT ||
    queueName === JOB_QUEUE_NAMES.ATTEMPT_HEAVY
  );
}

/**
 * Delay before the next attempt, in milliseconds.
 *
 * 0 means "retry immediately", which is what every failure did before this
 * existed and what every failure outside the transient-fetch class still does.
 */
export function calculateAttemptRetryDelayMs(
  attemptsMade: number,
  error: unknown,
  overrides: AttemptRetryBackoffOverrides = {},
): number {
  if (!isRetryableUrlFetchFailure(error)) {
    return 0;
  }

  const random = overrides.random ?? Math.random;
  const now = overrides.now ?? Date.now;

  // attemptsMade is 1 on the first retry, so the first window is the base
  // delay and each further attempt doubles it.
  const exponent = Math.max(0, attemptsMade - 1);
  const ceiling = Math.min(
    RETRYABLE_FETCH_BASE_DELAY_MS * 2 ** exponent,
    RETRYABLE_FETCH_MAX_DELAY_MS,
  );
  const floor = Math.round(ceiling * (1 - RETRYABLE_FETCH_JITTER));
  const jittered = Math.round(floor + random() * (ceiling - floor));

  // An upstream that told us when to come back outranks the computed window,
  // but never past the ceiling.
  const requested = requestedRetryDelayMs(error, now());
  return Math.min(Math.max(jittered, requested), RETRYABLE_FETCH_MAX_DELAY_MS);
}

/**
 * Wait the upstream itself asked for, in milliseconds, or 0 when it asked for
 * nothing. Reads the rate-limit fields carried on GithubRateLimitedError
 * (`retry-after` seconds and the `x-ratelimit-reset` epoch); both are optional
 * and may arrive as plain properties on a deserialized error, so each is read
 * through a typeof guard rather than a cast to the class.
 */
function requestedRetryDelayMs(error: unknown, nowMs: number): number {
  if (!(error instanceof Error)) {
    return 0;
  }

  const rawRetryAfter = (error as { retryAfterSeconds?: unknown })
    .retryAfterSeconds;
  const retryAfterMs =
    typeof rawRetryAfter === "number" && Number.isFinite(rawRetryAfter)
      ? rawRetryAfter * 1000
      : 0;

  const rawResetAt = (error as { resetAt?: unknown }).resetAt;
  const resetInMs =
    typeof rawResetAt === "number" && Number.isFinite(rawResetAt)
      ? rawResetAt * 1000 - nowMs
      : 0;

  return Math.max(0, retryAfterMs, resetInMs);
}
