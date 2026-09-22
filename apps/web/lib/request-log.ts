/**
 * A short, in-memory record of this tab's recent calls to our API, attached to
 * a bug report so triage can find the exact failing request in the logs. It
 * keeps where a call went and how it ended — never what was sent or received,
 * and never a query string. Nothing here is persisted.
 */

export interface RecordedRequest {
  method: string;
  path: string;
  /** null when no response arrived (dropped connection, timeout, abort). */
  status: number | null;
  ms: number;
  requestId?: string;
  at: string;
}

const MAX_ENTRIES = 20;
const entries: RecordedRequest[] = [];

let original: typeof fetch | undefined;
let installs = 0;

export function recentRequests(): RecordedRequest[] {
  return entries.map((entry) => ({ ...entry }));
}

export function clearRequestLog(): void {
  entries.length = 0;
}

function record(entry: RecordedRequest): void {
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
}

/** The path of a call to our own API, or undefined for anything else. */
function apiPath(input: RequestInfo | URL): string | undefined {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return undefined;
    return url.pathname.startsWith("/api/") ? url.pathname : undefined;
  } catch {
    // An unparseable target is not one of ours; leave it to fetch to reject.
    return undefined;
  }
}

/**
 * Wraps `window.fetch` so every caller is covered, including the ones that do
 * not go through the API client. The wrapper only observes: it returns the
 * same response and rethrows the same error.
 *
 * @returns A function that removes the wrapper again
 */
export function installRequestLog(): () => void {
  if (typeof window === "undefined") return () => undefined;

  installs += 1;
  if (installs === 1) {
    const inner = window.fetch;
    original = inner;
    window.fetch = async (input, init) => {
      const path = apiPath(input);
      if (!path) return inner(input, init);

      const started = Date.now();
      const method = (
        init?.method ??
        (typeof input === "object" && "method" in input ? input.method : "GET")
      ).toUpperCase();
      const at = new Date(started).toISOString();
      try {
        const response = await inner(input, init);
        record({
          method,
          path,
          status: response.status,
          ms: Date.now() - started,
          requestId: response.headers?.get("x-request-id") ?? undefined,
          at,
        });
        return response;
      } catch (error) {
        record({ method, path, status: null, ms: Date.now() - started, at });
        throw error;
      }
    };
  }

  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    installs -= 1;
    if (installs === 0 && original) {
      window.fetch = original;
      original = undefined;
    }
  };
}
