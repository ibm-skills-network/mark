/**
 * Mark stores every uploaded object under `<path>/<id>-<original name>`, where
 * `<id>` is a base36 millisecond timestamp (8 chars until 2059) followed by
 * base36 random digits. Keys written before the random part was fixed-length
 * carry 9-14 random digits; new keys always carry RANDOM_DIGITS.
 */
const TIMESTAMP_DIGITS = 8;
const RANDOM_DIGITS = 10;
const STORAGE_KEY_PREFIX_PATTERN = /^([\da-z]{8})([\da-z]{9,14})-(.+)$/;
// Earliest plausible upload; ids decoding to anything older are not Mark's.
const EARLIEST_UPLOAD_MS = Date.UTC(2020, 0, 1);
const CLOCK_SKEW_ALLOWANCE_MS = 86_400_000;

export function generateStorageKeyId(): string {
  const timestamp = Date.now().toString(36).padStart(TIMESTAMP_DIGITS, "0");
  const random = Math.random()
    .toString(36)
    .slice(2, 2 + RANDOM_DIGITS)
    .padEnd(RANDOM_DIGITS, "0");
  return `${timestamp}${random}`;
}

/**
 * Removes a leading Mark storage-key id (`<id>-`) from a file name. Anything
 * that does not have the exact id shape and a plausible timestamp is returned
 * unchanged, so a learner's own `final-report.xlsx` is never altered.
 */
export function stripStorageKeyPrefix(filename: string): string {
  const match = STORAGE_KEY_PREFIX_PATTERN.exec(filename);
  if (!match) return filename;

  const timestampMs = Number.parseInt(match[1], 36);
  const latestPlausibleMs = Date.now() + CLOCK_SKEW_ALLOWANCE_MS;
  if (timestampMs < EARLIEST_UPLOAD_MS || timestampMs > latestPlausibleMs) {
    return filename;
  }

  return match[3];
}

/** Original upload name for a storage key: basename minus Mark's id prefix. */
export function displayNameFromStorageKey(key: string): string {
  const basename = key.split("/").pop() || key;
  return stripStorageKeyPrefix(basename);
}

const FALLBACK_FILENAME = "download";

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replaceAll(
    /['()*]/g,
    (char) => `%${(char.codePointAt(0) ?? 0).toString(16).toUpperCase()}`,
  );
}

/**
 * Content-Disposition value with an ASCII-only quoted `filename` (quotes,
 * backslashes, control and non-ASCII characters replaced) plus an RFC 5987
 * `filename*` carrying the exact UTF-8 name for clients that support it.
 */
export function buildContentDisposition(
  type: "inline" | "attachment",
  filename: string,
): string {
  const name = filename || FALLBACK_FILENAME;
  const asciiName = name.replaceAll(/[^\u0020-\u007E]|["\\]/g, "_");
  return `${type}; filename="${asciiName}"; filename*=UTF-8''${encodeRfc5987(name)}`;
}
