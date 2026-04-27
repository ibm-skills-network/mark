const MAX_LEN = 500;
// Matches C0 controls (U+0000–U+001F, includes \t \n \r) and DEL (U+007F).
// Strip them before logging user-controlled values so an attacker cannot
// inject newlines/CR to forge extra log lines or terminal escape sequences
// to smuggle ANSI codes into log viewers (CWE-117, Log Forging).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

export function sanitizeForLog<T>(value: T): T | string {
  if (typeof value !== "string") return value;
  const cleaned = value.replaceAll(CONTROL_CHARS, " ");
  return cleaned.length > MAX_LEN ? cleaned.slice(0, MAX_LEN) + "…" : cleaned;
}
