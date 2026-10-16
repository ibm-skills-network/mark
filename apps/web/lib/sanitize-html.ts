import DOMPurify from "dompurify";
import {
  createRichTextSanitizer,
  isAllowedEmbedSource as allowedEmbed,
} from "rich-text";
export { EMBED_SANDBOX } from "rich-text";

export function isAllowedEmbedSource(source: string | null): boolean {
  return (
    typeof window !== "undefined" && allowedEmbed(source, window.location.href)
  );
}

let sanitize: ((html: string) => string) | undefined;
export function sanitizeHtml(html: string | null | undefined): string {
  const raw = html ?? "";
  if (typeof window === "undefined") return raw.replace(/<[^>]*(?:>|$)/g, "");
  sanitize ??= createRichTextSanitizer(DOMPurify, () => window.location.href);
  return sanitize(raw);
}
