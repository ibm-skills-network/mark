import DOMPurify from "dompurify";

/**
 * Sanitize an HTML string before it is written to `innerHTML`.
 *
 * The Quill-based viewer/editor render HTML that can originate from untrusted
 * sources (stored assignment content, learner submissions, hostile clients).
 * Quill itself does not strip active content, so every string is run through
 * DOMPurify before it reaches the DOM. The profile keeps the formatting tags,
 * classes, and data-attributes Quill emits — including the `<iframe>` video
 * embeds it produces (without `srcdoc`, so an iframe cannot smuggle active
 * markup) — while removing `<script>`, inline event handlers, and
 * `javascript:`-style URLs.
 *
 * Safe to call during SSR: falls back to stripping all tags when the DOM is
 * unavailable so active content never appears in the initial HTML payload.
 * Components that call this directly in JSX (not inside a useEffect) should
 * add suppressHydrationWarning on the target element to silence the expected
 * server/client text-vs-html difference.
 */
export function sanitizeHtml(html: string | null | undefined): string {
  const raw = html ?? "";
  if (typeof window === "undefined") {
    // No DOM on the server: strip all tags as a safe fallback. The `(>|$)`
    // anchor also consumes an unterminated trailing tag (e.g. a dangling
    // `<img src=x onerror=...` with no closing `>`), so no `<` survives and
    // the browser cannot parse the result as active markup.
    return raw.replace(/<[^>]*(?:>|$)/g, "");
  }
  return DOMPurify.sanitize(raw, {
    ADD_TAGS: ["iframe"],
    ADD_ATTR: ["allow", "allowfullscreen", "frameborder", "scrolling"],
  });
}
