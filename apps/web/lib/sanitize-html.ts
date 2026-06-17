import DOMPurify from "dompurify";

/**
 * Sanitize an HTML string before it is written to `innerHTML`.
 *
 * The Quill-based viewer/editor render HTML that can originate from untrusted
 * sources (stored assignment content, learner submissions, hostile clients).
 * Quill itself does not strip active content, so every string is run through
 * DOMPurify before it reaches the DOM. The default profile preserves the
 * formatting tags, classes, and data-attributes Quill emits while removing
 * `<script>`, inline event handlers, and `javascript:`-style URLs.
 *
 * Call this in the browser only (e.g. inside an effect): DOMPurify needs a DOM.
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html);
}
