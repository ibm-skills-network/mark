const MAX_LEN = 500;
// Matches C0 controls (U+0000–U+001F, includes \t \n \r) and DEL (U+007F).
// Strip them before logging user-controlled values so an attacker cannot
// inject newlines/CR to forge extra log lines or terminal escape sequences
// to smuggle ANSI codes into log viewers (CWE-117, Log Forging).
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
 * Keeps a URL's query string for debugging but replaces the value of any
 * parameter known to carry a credential or a single-use grant.
 *
 * Used for the request URL, which is worth keeping in full for diagnostics.
 * Never throws: a value that is not a parseable URL is split on the first `?`
 * and `#` and returned otherwise unchanged.
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
