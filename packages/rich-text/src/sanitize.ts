import type { DOMPurify } from "dompurify";

export const EMBED_SANDBOX =
  "allow-scripts allow-same-origin allow-presentation";
const EMBED_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "youtu.be",
  "vimeo.com",
  "player.vimeo.com",
]);

export function isAllowedEmbedSource(
  source: string | null,
  baseUrl: string,
): boolean {
  if (!source) return false;
  try {
    const url = new URL(source, baseUrl);
    return (
      url.protocol === "https:" && EMBED_HOSTS.has(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

export function createRichTextSanitizer(
  purify: DOMPurify,
  baseUrl: () => string,
) {
  purify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName !== "IFRAME") return;
    if (!isAllowedEmbedSource(node.getAttribute("src"), baseUrl())) {
      node.remove();
      return;
    }
    node.setAttribute("sandbox", EMBED_SANDBOX);
    node.setAttribute("referrerpolicy", "no-referrer");
  });
  return (html: string) =>
    purify.sanitize(html, {
      ADD_TAGS: ["iframe"],
      ADD_ATTR: ["allow", "allowfullscreen", "frameborder", "scrolling"],
      FORBID_TAGS: ["form", "input", "button", "textarea", "object", "embed"],
    });
}
