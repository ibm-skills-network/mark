const SECRET_KEYS = new Set(["cookie", "authorization", "token", "bearer"]);

/**
 * Replaces values whose JSON key matches a known auth-secret name with [REDACTED].
 * Key match is case-insensitive on the lowercased key; values themselves are NOT
 * inspected — preserves business fields whose contents may incidentally contain
 * words like "cookie".
 *
 * If the input is not parseable JSON, returns it unchanged. Caller is responsible
 * for truncation via sanitizeForLog after this returns.
 */
export function redactAuthSecrets(body: string): string {
  if (!body) return body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  const redacted = walk(parsed);
  try {
    return JSON.stringify(redacted);
  } catch {
    return body;
  }
}

function walk(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => walk(item));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.has(k.toLowerCase()) ? "[REDACTED]" : walk(v);
    }
    return out;
  }
  return value;
}
