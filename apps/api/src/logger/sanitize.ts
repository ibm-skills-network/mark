const MAX_LEN = 500;

// handles various escape chars, \r,\n
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

export function sanitizeForLog<T>(value: T): T | string {
  if (typeof value !== "string") return value;
  const cleaned = value.replaceAll(CONTROL_CHARS, " ");
  return cleaned.length > MAX_LEN ? cleaned.slice(0, MAX_LEN) + "…" : cleaned;
}
