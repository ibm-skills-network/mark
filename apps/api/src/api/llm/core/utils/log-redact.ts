import { createHash } from "node:crypto";

/**
 * Produce a short, deterministic fingerprint for a string suitable for
 * structured logs. Use this in place of raw prompt/response snippets — the
 * hash lets operators correlate the same input across log lines without
 * leaking the underlying content (which may include PII for learner
 * submissions).
 *
 * Returns `null` for empty / nullish input so the field can be elided.
 */
export function hashForLog(value: string | null | undefined): string | null {
  if (!value) return null;
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
