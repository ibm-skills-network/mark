import { stripStorageKeyPrefix } from "src/api/files/services/storage-key";

const QUOTED_FILENAME_PATTERN = /["'`]([^\n\r"'`]+?\.[\dA-Za-z]{2,10})["'`]/;
const BARE_FILENAME_PATTERN = /\b([\w.-]+\.[\dA-Za-z]{2,10})\b/;
const FILENAME_REQUIREMENT_PATTERN =
  /file\s*name|filename|name of (?:the )?file|file named|file called/i;
const NAMED_FILENAME_PATTERN =
  /\b(?:named|called)\s+["'`]?([^\n\r"'`]+?\.[\da-z]{2,10})/i;

function sanitizeFilename(filename: string): string {
  const trimmed = filename.trim().replaceAll(/^["'`]+|["'`]+$/g, "");
  const basename = trimmed.split(/[/\\]/).pop() ?? trimmed;
  return basename.trim();
}

export function mentionsFilenameRequirement(text: string): boolean {
  if (!text) return false;

  return (
    FILENAME_REQUIREMENT_PATTERN.test(text) || NAMED_FILENAME_PATTERN.test(text)
  );
}

export function extractExpectedFilenameFromText(text: string): string | null {
  if (!text) return null;

  const quotedMatch = text.match(QUOTED_FILENAME_PATTERN);
  if (quotedMatch?.[1]) {
    return sanitizeFilename(quotedMatch[1]);
  }

  const namedMatch = text.match(NAMED_FILENAME_PATTERN);
  if (namedMatch?.[1]) {
    return sanitizeFilename(namedMatch[1]);
  }

  const bareMatch = text.match(BARE_FILENAME_PATTERN);
  if (bareMatch?.[1]) {
    return sanitizeFilename(bareMatch[1]);
  }

  return null;
}

// Browser duplicate-download suffix right before the extension: "name (1).xlsx".
const COPY_SUFFIX_PATTERN = /\s*\(\d{1,3}\)(\.[^.]+)$/;

/**
 * Collapses a repeated trailing extension ("name.xlsx.xlsx", "name.xlsx..xlsx",
 * "name..xlsx") into one. Callers lowercase first. Only identical extensions
 * collapse, so "name.xlsx.csv" keeps both parts and still fails.
 */
function collapseRepeatedExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  const extension = filename.slice(lastDot + 1);
  if (lastDot <= 0 || !extension) return filename;

  const suffix = `.${extension}`;
  let stem = filename.slice(0, lastDot);
  for (;;) {
    stem = stem.replace(/\.+$/, "");
    if (!stem.endsWith(suffix)) break;
    stem = stem.slice(0, -suffix.length);
  }
  return stem ? `${stem}${suffix}` : filename;
}

/**
 * Undoes renames that happen to a correctly named file on its way back to
 * Mark: Mark's own storage-key prefix (a re-downloaded submission), a browser
 * " (N)" duplicate suffix, and an extension typed by the learner and then
 * appended again by the application.
 */
function normalizeUploadedFilename(filename: string): string {
  let name = stripStorageKeyPrefix(filename);
  name = collapseRepeatedExtension(name);
  name = name.replace(COPY_SUFFIX_PATTERN, "$1");
  return collapseRepeatedExtension(name);
}

export function filenamesMatch(
  actualFilename: string,
  expectedFilename: string,
): boolean {
  if (!actualFilename || !expectedFilename) return false;

  const actual = sanitizeFilename(actualFilename).toLowerCase();
  const expected = sanitizeFilename(expectedFilename).toLowerCase();
  if (!actual || !expected) return false;
  if (actual === expected) return true;

  return normalizeUploadedFilename(actual) === expected;
}
