import type { Part } from "../contracts";
import { htmlToMarkdown } from "../html-text";
import { NOTEBOOK_MAX_IMAGE_OUTPUTS } from "../limits";

/** Embedded images smaller than this (icons, bullets) are not sent. */
const MIN_EMBEDDED_IMAGE_BYTES = 2 * 1024;

const DATA_IMAGE =
  /<img\b[^>]*?\bsrc\s*=\s*["']data:(image\/[\w+.-]+);base64,([\d\s+/=a-z]+)["'][^>]*>/gi;

/**
 * An uploaded HTML file (often a notebook exported with nbconvert) as
 * Markdown text plus its embedded images. Styles and scripts can be most of
 * such a file, so sending it raw would push the learner's cells past the
 * per-file cap.
 */
export function htmlFileToParts(
  name: string,
  html: string,
  options: { maxImages?: number } = {},
): Part[] {
  const maxImages = options.maxImages ?? NOTEBOOK_MAX_IMAGE_OUTPUTS;
  const images: Part[] = [];
  let omitted = 0;
  const withMarkers = html.replaceAll(
    DATA_IMAGE,
    (_tag, mimeType: string, data: string) => {
      const base64 = data.replaceAll(/\s+/g, "");
      if (Buffer.byteLength(base64, "base64") < MIN_EMBEDDED_IMAGE_BYTES) {
        return " ";
      }
      if (images.length >= maxImages) {
        omitted += 1;
        return " ";
      }
      const index = images.length + 1;
      images.push({
        name: `${name} › image ${index}`,
        kind: "image",
        mimeType,
        base64,
      });
      return `<p>[image ${index}]</p>`;
    },
  );
  let text = htmlToMarkdown(withMarkers).trim();
  if (omitted > 0) {
    text += `\n\n[${omitted} more embedded image(s) not sent]`;
  }
  return [{ name, kind: "text", mimeType: "text/html", text }, ...images];
}
