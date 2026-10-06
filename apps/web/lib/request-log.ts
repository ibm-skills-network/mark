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

const MAX_ERROR_ENTRIES = 10;
const MAX_ERROR_TEXT = 200;
const errorEntries: RecordedClientError[] = [];

let original: typeof fetch | undefined;
let installs = 0;

export function recentRequests(): RecordedRequest[] {
  return entries.map((entry) => ({ ...entry }));
}

export function clearRequestLog(): void {
  entries.length = 0;
  errorEntries.length = 0;
}

/**
 * A failure the learner was shown, as the browser saw it. The request log only
 * knows when headers arrived, so a 200 whose body then failed to arrive or
 * parse used to look exactly like a success; this keeps what was thrown.
 * Only the error's type and its own wording are kept, with any quoted fragment
 * removed (parsers quote the start of the body they choked on).
 */
export interface RecordedClientError {
  name: string;
  message?: string;
  /** NetworkError kind (timeout, unreachable, interrupted), when it has one. */
  kind?: string;
  /** The underlying error a NetworkError was classified from. */
  detail?: string;
  /** Which screen or layer surfaced it. */
  where: string;
  /** API path involved, without its query string. */
  path?: string;
  at: string;
}

/** Error wording with quoted fragments elided and its length bounded. */
export function redactErrorText(value: string): string {
  return value
    .replace(/"[^"]*"/g, '"…"')
    .replace(/'[^']*'/g, "'…'")
    .slice(0, MAX_ERROR_TEXT);
}

function stripQuery(path: string): string {
  return path.split("?")[0];
}

export function recordClientError(
  error: unknown,
  context: { where: string; path?: string },
): void {
  // Kept for the browser's bug reports only; on the server this module is
  // shared by every request, so nothing is collected there.
  if (typeof window === "undefined") return;
  const bag =
    typeof error === "object" && error !== null
      ? (error as {
          name?: unknown;
          message?: unknown;
          kind?: unknown;
          detail?: unknown;
        })
      : undefined;
  const name = bag && typeof bag.name === "string" ? bag.name : typeof error;
  const message =
    bag && typeof bag.message === "string"
      ? redactErrorText(bag.message)
      : undefined;

  errorEntries.push({
    name: name.slice(0, 60),
    message,
    kind:
      bag && typeof bag.kind === "string" ? bag.kind.slice(0, 20) : undefined,
    detail:
      bag && typeof bag.detail === "string"
        ? redactErrorText(bag.detail)
        : undefined,
    where: context.where.slice(0, 60),
    path: context.path ? stripQuery(context.path).slice(0, 300) : undefined,
    at: new Date().toISOString(),
  });
  if (errorEntries.length > MAX_ERROR_ENTRIES) {
    errorEntries.splice(0, errorEntries.length - MAX_ERROR_ENTRIES);
  }
}

export function recentClientErrors(): RecordedClientError[] {
  return errorEntries.map((entry) => ({ ...entry }));
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
