/* eslint-disable unicorn/no-null */

const PADDED_BASE64 = /^[\d+/A-Za-z]+={0,2}$/;
const OUTSIDE_BASE64_ALPHABET = /[^\d+/=A-Za-z]/;
const utf8 = new TextDecoder("utf8", { fatal: true });

/** Control characters other than tab, line feed and carriage return. */
function hasControlChar(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127)
      return true;
  }
  return false;
}

/**
 * Text saved through the legacy transport encoding is stored as base64 of the
 * real value. Routes that serve plain JSON decode it here. A value is only
 * decoded when it is canonical padded base64 of valid UTF-8 text with no
 * control characters, and the text holds a character base64 cannot, so plain
 * words that happen to be valid base64 are left alone.
 */
export function unwrapLegacyText(value: string | null): string | null {
  if (
    !value ||
    value.length < 8 ||
    value.length % 4 !== 0 ||
    !PADDED_BASE64.test(value)
  ) {
    return value;
  }

  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) return value;

  let decoded: string;
  try {
    decoded = utf8.decode(bytes);
  } catch {
    // Not UTF-8, so the value is not encoded text.
    return value;
  }

  if (hasControlChar(decoded) || !OUTSIDE_BASE64_ALPHABET.test(decoded)) {
    return value;
  }

  return decoded;
}
