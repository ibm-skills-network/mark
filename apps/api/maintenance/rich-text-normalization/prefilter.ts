import { mapJsonStrings } from "./json-codec";
import type { Conversion, Model, Snapshot } from "./types";

// Anything that could spell a Quill class or list attribute, directly or through
// JSON (\u) or HTML (&#) escapes. Attribute names are case-insensitive in HTML.
const LEGACY_HINT = /ql-|data-list|\\u|&#/i;

// Mirrors transformEnvelope's shape checks for text with no legacy markup.
function envelopeIsInert(
  value: string,
  kind: "html" | "draft",
  depth = 0,
): boolean {
  if (depth > 5) return false;
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(value);
    } catch {
      // Malformed wrapper: let the isolated converter quarantine it.
      return false;
    }
    return (
      typeof decoded === "string" && envelopeIsInert(decoded, kind, depth + 1)
    );
  }
  if (kind === "html") return true;
  if (!trimmed.startsWith("[")) return false;
  try {
    mapJsonStrings(value, (leaf) => leaf);
    return true;
  } catch {
    // Invalid draft JSON: let the isolated converter quarantine it.
    return false;
  }
}

/**
 * Returns an "unchanged" conversion when the row provably has nothing to convert
 * or report, so the isolated parser is skipped. Any doubt returns undefined and
 * the row goes through the full converter.
 */
export function unchangedWithoutParsing(
  model: Model,
  snapshot: Snapshot,
): Conversion | undefined {
  const values = Object.values(snapshot.values);
  const extra = Object.values(snapshot.extra ?? {});
  for (const value of [...values, ...extra]) {
    if (value === null || value === undefined) continue;
    if (typeof value !== "string" || LEGACY_HINT.test(value)) return undefined;
  }
  if (model.name === "QuestionResponse" && snapshot.context) {
    try {
      JSON.parse(snapshot.context);
    } catch {
      return undefined;
    }
  }
  for (const field of model.fields) {
    const value = snapshot.values[field];
    // The converter rejects a missing field, so only null and "" are inert.
    if (value === undefined) return undefined;
    if (value === null || value === "") continue;
    if (model.name === "QuestionResponse" && !envelopeIsInert(value, "html"))
      return undefined;
    if (model.jsonFields?.includes(field) && !envelopeIsInert(value, "draft"))
      return undefined;
  }
  return {
    state: "unchanged",
    before: snapshot.values,
    after: { ...snapshot.values },
    rules: [],
  };
}
