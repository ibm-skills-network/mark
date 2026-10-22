/**
 * Decode the base64 `content` of a GitHub contents API response as UTF-8.
 * `atob` alone yields one character per byte, which garbles every non-ASCII
 * character (accents, Cyrillic, CJK, emoji) in a learner's file.
 */
export function decodeGithubFileContent(base64: string): string {
  const binary = atob(base64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}
