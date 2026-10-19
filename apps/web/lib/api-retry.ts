import { APIError, isNetworkError } from "./api-client";

/**
 * Statuses worth retrying: request timeout and gateway/availability hiccups.
 * A 500 is excluded — it usually reproduces, and retrying it just doubles the
 * load that broke it. The API answers 503 when its database connection drops
 * for a moment, which is exactly the case a short wait fixes.
 */
const TRANSIENT_STATUSES = new Set([408, 502, 503, 504]);

/**
 * Pause before each retry. A database or pooler connection drop lasts about a
 * second; a single retry 250ms later landed inside the same outage and the
 * learner saw the error anyway. Each delay is spread ±20% so a crowd of
 * learners who failed together do not all come back in the same instant.
 */
const RETRY_DELAYS_MS = [1000, 2500];

/**
 * A response that arrived incomplete is retried once only: when an
 * intermediary is mangling bodies, more attempts just spend the learner's data
 * on the same result.
 */
const MAX_INTERRUPTED_RETRIES = 1;

/**
 * A transient failure that itself took this long is not retried: a 504 from
 * the 30s proxy timeout has already cost the learner half a minute, and
 * repeating it would double or triple that before they are told anything.
 */
const SLOW_FAILURE_MS = 10_000;

/**
 * True for failures that are plausibly momentary: a transient HTTP status, a
 * connection that dropped (connection resets, DNS blips, dead keep-alive
 * sockets — all of which reject the fetch immediately), or a success response
 * whose body arrived incomplete.
 *
 * A request that timed out is excluded. It has already spent the client's
 * whole waiting budget, so a second attempt doubles the time before the
 * learner is told anything; they are shown the connection screen and can
 * retry deliberately instead.
 */
export function isTransientApiError(error: unknown): boolean {
  if (error instanceof APIError) {
    return TRANSIENT_STATUSES.has(error.status);
  }
  if (isNetworkError(error)) {
    return error.kind === "unreachable" || error.kind === "interrupted";
  }
  return error instanceof TypeError;
}

/** True when the failure means the caller's session/permissions are the problem. */
export function isAuthApiError(error: unknown): boolean {
  return (
    error instanceof APIError && (error.status === 401 || error.status === 403)
  );
}

/**
 * True only when the server said the thing does not exist. Every other failure
 * — a fault, a gateway error, a dropped connection — means "we could not find
 * out", which is not the same answer and must not be shown as one.
 */
export function isNotFoundApiError(error: unknown): boolean {
  return error instanceof APIError && error.status === 404;
}

function maxRetriesFor(error: unknown): number {
  if (isNetworkError(error) && error.kind === "interrupted") {
    return MAX_INTERRUPTED_RETRIES;
  }
  return RETRY_DELAYS_MS.length;
}

function jittered(delayMs: number): number {
  return Math.round(delayMs * (0.8 + Math.random() * 0.4));
}

/**
 * Runs `fn`, retrying with backoff while it fails transiently (see
 * RETRY_DELAYS_MS). Definitive failures propagate immediately.
 *
 * Only for idempotent reads: a retried write can apply twice. Every caller
 * wraps a GET.
 */
export async function withTransientRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let retry = 0; ; retry++) {
    const started = Date.now();
    try {
      return await fn();
    } catch (error) {
      const slow = Date.now() - started >= SLOW_FAILURE_MS;
      if (
        !isTransientApiError(error) ||
        slow ||
        retry >= maxRetriesFor(error)
      ) {
        throw error;
      }
      const delayMs = jittered(RETRY_DELAYS_MS[retry]);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
