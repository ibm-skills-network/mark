import { isNetworkError, type NetworkFailureKind } from "./api-client";

/**
 * Retry policy and copy for the learner results page when its data could not
 * be loaded for a reason that is likely to clear on its own.
 *
 * The browser reaches the API through the Next `/api` rewrite, whose proxy
 * gives up after 30s and answers `500 Internal Server Error`. When the API is
 * slow (a cache or database outage), the attempt exists but the read times
 * out — telling the learner it is missing, or that their session is wrong, is
 * untrue and sends them chasing a problem they do not have. These failures get
 * a "we're having trouble" screen that retries by itself and offers a manual
 * retry; a real 404, 401 or 403 keeps its own screen.
 */
export type RetryableResultsFailure =
  | { kind: "network"; networkKind: NetworkFailureKind }
  | { kind: "http"; status: number };

/**
 * 4xx statuses that describe a momentary condition rather than the request or
 * the session: request timeout, too early, and rate limiting.
 */
const RETRYABLE_CLIENT_STATUSES: ReadonlySet<number> = new Set([408, 425, 429]);

/**
 * Pause before each automatic retry, spread ±20%. A single learner retrying
 * three times is negligible load, but a whole cohort that failed together
 * during an outage must not come back in the same instant. Each retry can
 * itself take up to the 30s proxy timeout, so the schedule stops after three
 * and leaves further attempts to the learner.
 */
export const RESULTS_RETRY_DELAYS_MS: readonly number[] = [2000, 5000, 10_000];

function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

/**
 * Classifies a failed results-page read. Returns null for failures that must
 * keep their own screen: a real 404 (the attempt is not there), 401/403 (the
 * session is the problem), and any other 4xx (the request itself is wrong and
 * repeating it changes nothing).
 *
 * `untypedFailuresAreRetryable` covers readers that do not carry a status on
 * their errors (the user lookup throws a bare Error for every non-401
 * response, and a raw TypeError when the connection drops).
 */
export function classifyResultsLoadFailure(
  error: unknown,
  options: { untypedFailuresAreRetryable?: boolean } = {},
): RetryableResultsFailure | null {
  if (isNetworkError(error)) {
    return { kind: "network", networkKind: error.kind };
  }

  const status = statusOf(error);
  if (status !== undefined) {
    if (status >= 500 || RETRYABLE_CLIENT_STATUSES.has(status)) {
      return { kind: "http", status };
    }
    return null;
  }

  if (!options.untypedFailuresAreRetryable) {
    return null;
  }
  // fetch rejects with a TypeError for every connection-level failure.
  if (error instanceof TypeError) {
    return { kind: "network", networkKind: "unreachable" };
  }
  return { kind: "http", status: 500 };
}

/**
 * Delay before automatic retry number `retryIndex` (0-based), or null once the
 * automatic retries are spent.
 */
export function resultsRetryDelayMs(
  retryIndex: number,
  random: () => number = Math.random,
): number | null {
  const base = RESULTS_RETRY_DELAYS_MS[retryIndex];
  if (base === undefined) {
    return null;
  }
  return Math.round(base * (0.8 + random() * 0.4));
}

export function hasAutomaticRetriesLeft(retriesSoFar: number): boolean {
  return retriesSoFar < RESULTS_RETRY_DELAYS_MS.length;
}

export const RESULTS_TROUBLE_COPY = {
  headline: "We're having trouble loading your results",
  message:
    "Your submission is saved and your grade is safe. Our servers are slow to respond right now, so your results did not load.",
  retryingAutomatically: "Trying again automatically…",
  retryingNow: "Loading your results again…",
  retriesExhausted:
    "Your results still did not load. Use Try again in a moment.",
  steps: [
    {
      title: "Wait a moment",
      description:
        "This page tries again by itself a few times. Most delays clear within a minute.",
    },
    {
      title: "Try again",
      description: "Load your results again whenever you are ready.",
    },
    {
      title: "Nothing is lost",
      description:
        "Your submission and grade were saved before this page started loading.",
    },
  ],
} as const;

/**
 * Every English string the trouble screen renders. UI translation catalogs
 * are keyed by exact source text, so exporting the list is what lets a test
 * catch a string no catalog knows about.
 */
export const RESULTS_TROUBLE_SOURCE_STRINGS: readonly string[] = Array.from(
  new Set([
    RESULTS_TROUBLE_COPY.headline,
    RESULTS_TROUBLE_COPY.message,
    RESULTS_TROUBLE_COPY.retryingAutomatically,
    RESULTS_TROUBLE_COPY.retryingNow,
    RESULTS_TROUBLE_COPY.retriesExhausted,
    ...RESULTS_TROUBLE_COPY.steps.flatMap((step) => [
      step.title,
      step.description,
    ]),
  ]),
);
