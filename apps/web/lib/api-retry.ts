import { APIError, isNetworkError } from "./api-client";

/**
 * Statuses worth one retry: request timeout and gateway hiccups. A 500 is
 * excluded — it usually reproduces, and retrying it just doubles the load
 * that broke it.
 */
const TRANSIENT_STATUSES = new Set([408, 502, 503, 504]);

const RETRY_DELAY_MS = 250;

/**
 * True for failures that are plausibly momentary: a transient HTTP status, or
 * a connection that dropped (connection resets, DNS blips, dead keep-alive
 * sockets — all of which reject the fetch immediately).
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
    return error.kind === "unreachable";
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

/**
 * Runs `fn`, retrying exactly once (after a short pause) if the first attempt
 * fails transiently. Definitive failures propagate immediately.
 */
export async function withTransientRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!isTransientApiError(error)) {
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return fn();
  }
}
