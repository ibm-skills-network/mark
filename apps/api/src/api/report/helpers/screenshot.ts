import { randomUUID } from "node:crypto";

/**
 * Screenshots attached to issue reports are stored public-read, because SN
 * Support renders them straight from their URL in the agent's browser and
 * never fetches them itself. A public object is served from the storage
 * domain with whatever content type it was stored under, so the client's
 * claimed type and file name are never trusted: only raster formats
 * recognised from the file's own bytes are kept, and the key is a random
 * UUID — the unguessable key is what keeps the screenshot private.
 */

export interface ScreenshotFormat {
  mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  extension: "png" | "jpg" | "gif" | "webp";
}

// Mirrors the raster checks in ImageGradingStrategy.detectMimeFromBytes.
// SVG is deliberately absent: it can carry script.
export function detectScreenshotFormat(
  buffer: Buffer,
): ScreenshotFormat | undefined {
  if (buffer.length < 12) return undefined;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }

  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return { mimeType: "image/png", extension: "png" };
  }

  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return { mimeType: "image/gif", extension: "gif" };
  }

  // WEBP is a RIFF container with "WEBP" at offset 8.
  if (
    buffer.subarray(0, 4).toString("latin1") === "RIFF" &&
    buffer.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return { mimeType: "image/webp", extension: "webp" };
  }

  return undefined;
}

export function buildScreenshotKey(format: ScreenshotFormat): string {
  return `issue-screenshots/${randomUUID()}.${format.extension}`;
}
