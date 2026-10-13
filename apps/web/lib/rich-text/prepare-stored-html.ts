import { normalizeQuillHtml } from "rich-text";

import { sanitizeHtml } from "@/lib/sanitize-html";

// Normalize before sanitizing: rewriting sanitized HTML can reintroduce XSS.
export function prepareStoredHtml(
  value: string | null | undefined,
  { blockImages = false }: { blockImages?: boolean } = {},
): string {
  let html = normalizeQuillHtml(value ?? "").html;
  if (blockImages) {
    const document_ = new DOMParser().parseFromString("", "text/html");
    const root = document_.createElement("div");
    root.innerHTML = html;
    for (const image of root.querySelectorAll("img")) image.remove();
    html = root.innerHTML;
  }
  return sanitizeHtml(html);
}
