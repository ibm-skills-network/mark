/**
 * Replace unpaired UTF-16 surrogates with U+FFFD and delete NUL characters.
 *
 * Postgres' JSON parser rejects lone surrogates ("lone leading surrogate in
 * hex escape"), but `JSON.stringify` happily preserves them. LLM output that
 * truncates mid-codepoint is a common source. NUL (U+0000) is rejected by
 * both TEXT and jsonb ("unsupported Unicode escape sequence", SqlState 22P05);
 * file extraction of binary-ish uploads is a common source. Walk the value and
 * scrub strings before handing them to a `Json` column.
 *
 * Scrub the RAW value, not its `JSON.stringify` output: stringify escapes NUL
 * to the six-character sequence `\u0000`, which this scrubber would no longer
 * see but jsonb still rejects.
 */

const LONE_SURROGATE_RE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

// eslint-disable-next-line no-control-regex -- NUL is exactly the character being scrubbed
const NUL_RE = /\u0000/g;

export interface SanitizeResult<T> {
  value: T;
  replaced: number;
}

export function sanitizeUnicodeForJson<T>(input: T): SanitizeResult<T> {
  let replaced = 0;

  const walk = (value: unknown): unknown => {
    if (typeof value === "string") {
      let cleaned = value;
      if (LONE_SURROGATE_RE.test(cleaned)) {
        LONE_SURROGATE_RE.lastIndex = 0;
        cleaned = cleaned.replaceAll(LONE_SURROGATE_RE, () => {
          replaced += 1;
          return "�";
        });
      }
      if (NUL_RE.test(cleaned)) {
        NUL_RE.lastIndex = 0;
        cleaned = cleaned.replaceAll(NUL_RE, () => {
          replaced += 1;
          return "";
        });
      }
      return cleaned;
    }
    if (Array.isArray(value)) {
      return value.map((item) => walk(item));
    }
    if (value !== null && typeof value === "object") {
      // Pass through non-plain objects (Date, Buffer, etc.) unchanged.
      const proto: object | null = Object.getPrototypeOf(value) as
        | object
        | null;
      if (proto !== Object.prototype && proto !== null) return value;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = walk(v);
      }
      return out;
    }
    return value;
  };

  return { value: walk(input) as T, replaced };
}

/**
 * Convenience wrapper for callers that just want the sanitized value.
 */
export function scrubLoneSurrogates<T>(input: T): T {
  return sanitizeUnicodeForJson(input).value;
}
