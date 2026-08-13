import { APIError } from "./api-client";

/**
 * Statuses worth one retry: request timeout and gateway hiccups. A 500 is
 * excluded — it usually reproduces, and retrying it just doubles the load
 * that broke it.
 */
const TRANSIENT_STATUSES = new Set([408, 502, 503, 504]);

const RETRY_DELAY_MS = 250;

/**
 * True for failures that are plausibly momentary: a transient HTTP status, or
 * a network-level failure (fetch rejects with TypeError on connection resets,
 * DNS blips, and dropped keep-alive sockets).
 */
export function isTransientApiError(error: unknown): boolean {
  if (error instanceof APIError) {
    return TRANSIENT_STATUSES.has(error.status);
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
