/**
 * Reports a caught client-side error to Instana.
 *
 * `console.error` alone makes a failure "observable" only to whoever happens to
 * have a browser console open, which for a page a learner is sitting in front
 * of is nobody. Instana's EUM agent is already bootstrapped in `app/layout.tsx`
 * and exposes `window.ineum`, so anything reported here lands in the same place
 * as the uncaught errors it collects on its own.
 *
 * Callers keep their `console.error`: this is the production signal, not a
 * replacement for the one a developer reads while working.
 */

type InstanaReporter = (
  command: "reportError",
  error: Error,
  options?: { componentStack?: string; meta?: Record<string, string> },
) => void;

declare global {
  interface Window {
    ineum?: InstanaReporter;
  }
}

/**
 * The agent is only bootstrapped for production and staging, so it is absent in
 * development, in tests and during a server render. That is not an error — this
 * returns quietly and the caller carries on.
 */
export function reportClientError(
  error: unknown,
  meta: Record<string, string> = {},
): void {
  if (typeof window === "undefined" || typeof window.ineum !== "function") {
    return;
  }

  try {
    window.ineum(
      "reportError",
      error instanceof Error ? error : new Error(String(error)),
      // Instana drops a meta value that is not a string, so everything is
      // stringified before it goes out rather than silently arriving empty.
      {
        meta: Object.fromEntries(
          Object.entries(meta).map(([key, value]) => [key, String(value)]),
        ),
      },
    );
  } catch {
    // Reporting a failure must never become one. The agent is third-party code
    // that can be blocked, stubbed or half-initialised by an ad blocker.
  }
}
