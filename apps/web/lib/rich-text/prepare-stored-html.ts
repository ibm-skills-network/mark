import { normalizeQuillHtml } from "rich-text";

import { sanitizeHtml } from "@/lib/sanitize-html";

/**
 * Turns a stored rich-text value into markup this editor's schema can read.
 *
 * Two steps, and **the order is the point**. Sanitizing decides what is allowed
 * to exist at all, so it has to see the untrusted string first: normalizing
 * rewrites element structure, and rewriting markup before it has been made safe
 * means the sanitizer never sees what was actually written. Normalizing then
 * converts the previous editor's shapes into ones the schema recognises —
 * without it, stored bullets come back as numbered items, silently, because a
 * bullet was `<li data-list="bullet">` inside an `<ol>`.
 *
 * It exists as a function rather than two calls at each site because there are
 * three sites, and "sanitize first" was previously a comment repeated in each
 * one. A comment cannot stop the order being swapped.
 *
 * Needs a DOM: both steps parse. Call it on the client.
 */
export function prepareStoredHtml(value: string | null | undefined): string {
  return normalizeQuillHtml(sanitizeHtml(value ?? "")).html;
}
