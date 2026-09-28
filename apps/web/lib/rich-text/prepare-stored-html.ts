import { normalizeQuillHtml } from "rich-text";

import { sanitizeHtml } from "@/lib/sanitize-html";

/**
 * Turns a stored rich-text value into markup this editor's schema can read.
 *
 * Two steps, and **the order is the point**. Normalizing converts the previous
 * editor's shapes into ones the schema recognises — without it, stored bullets
 * come back as numbered items, silently, because a bullet was
 * `<li data-list="bullet">` inside an `<ol>`. Sanitizing runs last because its
 * output has to be final: normalizing parses and re-serializes, and doing that
 * to already-sanitized markup is the parse-serialize-parse round trip behind
 * mutation XSS. Normalizing untrusted input first is safe — it works in an
 * inert `DOMParser` document that never runs scripts or loads resources.
 *
 * It exists as a function rather than two calls at each site because there are
 * three sites, and the order was previously a comment repeated in each
 * one. A comment cannot stop the order being swapped.
 *
 * Needs a DOM: both steps parse. Call it on the client.
 */
export function prepareStoredHtml(value: string | null | undefined): string {
  return sanitizeHtml(normalizeQuillHtml(value ?? "").html);
}
