import { posix as posixPath } from "node:path";
import { BadRequestException } from "@nestjs/common";

// Matches a `..` segment bounded by `/` or string ends. POSIX-side traversal
// detector — applied to BOTH the raw input (so absolute paths like
// `/../etc/passwd` cannot be smuggled past via posix.normalize collapsing
// `..` against the root) AND the post-normalize form (catches embedded
// traversal like `a/b/../../c` that normalize reduces to `../c`).
const POSIX_TRAVERSAL = /(^|\/)\.\.(\/|$)/;

/**
 * Sanitize an upload path coming from a hostile frontend.
 *
 * Behavior:
 * - undefined / null / "" → returns "" (no path component)
 * - non-string → throws BadRequestException("Invalid upload path").
 *   The direct-upload handler accepts an untyped body, so class-validator
 *   does not run on this field — this guard is the only defense against
 *   array, number, or object payloads.
 * - contains a NUL byte → throws exception
 * - contains a backslash → throws (mixed-separator bypass — POSIX
 *   normalize does not collapse `\` so a payload like `..\..\authors`
 *   is a single segment under POSIX but a traversal under any consumer
 *   that treats `\` as a separator)
 * - input contains a `..` segment (pre-normalize OR post-normalize) → throws
 *   exception (traversal attempt)
 * - leading `/` is stripped from the returned, normalized form
 *
 * All rejection branches throw with the SAME generic message
 * "Invalid upload path". `AllExceptionsFilter` returns a generic
 * `{ statusCode: 400, message: "Invalid upload path" }` and logs at warn —
 * no field-leak, no input echo.
 */
export function sanitizeUploadPath(rawPath: string | undefined | null): string {
  if (rawPath === undefined || rawPath === null || rawPath === "") {
    return "";
  }
  if (typeof rawPath !== "string") {
    throw new BadRequestException("Invalid upload path");
  }
  if (rawPath.includes("\0")) {
    throw new BadRequestException("Invalid upload path");
  }
  if (rawPath.includes("\\")) {
    throw new BadRequestException("Invalid upload path");
  }
  if (POSIX_TRAVERSAL.test(rawPath) || rawPath === "..") {
    throw new BadRequestException("Invalid upload path");
  }
  const normalized = posixPath.normalize(rawPath);
  if (POSIX_TRAVERSAL.test(normalized) || normalized === "..") {
    throw new BadRequestException("Invalid upload path");
  }
  return normalized.startsWith("/") ? normalized.slice(1) : normalized;
}

export const MAX_UPLOAD_FILE_NAME_LENGTH = 255;

const isControlCharacter = (character: string): boolean => {
  const code = character.codePointAt(0) ?? 0;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
};

/**
 * Reduce a client-supplied upload file name to a safe storage-key segment:
 * the last path segment only (either separator), with control characters
 * removed. Rejects with a generic 400 when nothing usable is left or the
 * result is longer than MAX_UPLOAD_FILE_NAME_LENGTH characters.
 */
export function sanitizeUploadFileName(rawFileName: unknown): string {
  if (typeof rawFileName !== "string") {
    throw new BadRequestException("Invalid file name");
  }
  const segments = rawFileName.split(/[/\\]/);
  const baseName = [...(segments.at(-1) ?? "")]
    .filter((character) => !isControlCharacter(character))
    .join("")
    .trim();
  if (
    baseName.length === 0 ||
    baseName === "." ||
    baseName === ".." ||
    baseName.length > MAX_UPLOAD_FILE_NAME_LENGTH
  ) {
    throw new BadRequestException("Invalid file name");
  }
  return baseName;
}
