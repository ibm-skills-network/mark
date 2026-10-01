const MAX_LEN = 500;

// handles various escape chars, \r,\n
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

const REDACTED = "[redacted]";

// Query/fragment parameter names whose values are credentials or single-use
// grants. Anything else is kept, because query strings are useful in the
// access log.
const SENSITIVE_PARAM_NAMES = new Set([
  "code",
  "state",
  "token",
  "access_token",
  "authentication",
  "key",
  "secret",
  "signature",
]);

export function sanitizeForLog<T>(value: T): T | string {
  if (typeof value !== "string") return value;
  const cleaned = value.replaceAll(CONTROL_CHARS, " ");
  return cleaned.length > MAX_LEN ? cleaned.slice(0, MAX_LEN) + "…" : cleaned;
}

/**
 * Reduces a URL to its origin and path for logging, dropping the query string
 * and the fragment.
 *
 * Used for the `Referer` header: after an OAuth redirect the referring page URL
 * still carries the authorization code and the signed state, and every request
 * the page makes afterwards repeats them, so the whole query string is dropped
 * rather than filtered.
 *
 * Never throws: a value that is not a parseable URL is truncated at the first
 * `?` or `#` and returned as-is.
 */
export function redactUrlForLog(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "";

  const cutAt = Math.min(indexOrLength(value, "?"), indexOrLength(value, "#"));

  return sanitizeForLog(value.slice(0, cutAt));
}

/**
 * Keeps a URL's query string for debugging but replaces the value of any
 * parameter known to carry a credential or a single-use grant.
 *
 * Used for the request URL, which is worth keeping in full for diagnostics.
 */
export function redactSensitiveQueryForLog(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "";

  const hashIndex = value.indexOf("#");
  const beforeHash = hashIndex === -1 ? value : value.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? "" : value.slice(hashIndex + 1);

  const queryIndex = beforeHash.indexOf("?");
  const path = queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : beforeHash.slice(queryIndex + 1);

  const rebuilt =
    path +
    (queryIndex === -1 ? "" : "?" + redactParameters(query)) +
    (hashIndex === -1 ? "" : "#" + redactParameters(fragment));

  return sanitizeForLog(rebuilt);
}

function indexOrLength(value: string, marker: string): number {
  const index = value.indexOf(marker);
  return index === -1 ? value.length : index;
}

function redactParameters(parameters: string): string {
  return parameters
    .split("&")
    .map((pair) => {
      const separator = pair.indexOf("=");
      // A bare flag carries no value, so there is nothing to leak.
      if (separator === -1) return pair;

      const name = pair.slice(0, separator);
      // Names are compared as written: real clients never percent-encode them,
      // and decoding here would have to handle malformed escapes.
      if (!SENSITIVE_PARAM_NAMES.has(name.trim().toLowerCase())) return pair;

      return `${name}=${REDACTED}`;
    })
    .join("&");
}
