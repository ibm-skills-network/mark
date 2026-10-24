/** Longest BCP-47 tag the learner routes accept; longer values are ignored. */
export const MAX_LANG_LENGTH = 16;

/**
 * Normalise a raw `lang` query value. A repeated parameter arrives as an
 * array and uses its first value; anything that is not a short string is
 * treated as absent so the route serves authored content.
 */
export function normalizeLangQuery(raw: unknown): string | undefined {
  const value: unknown = Array.isArray(raw) ? (raw as unknown[])[0] : raw;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_LANG_LENGTH) {
    return undefined;
  }
  return trimmed;
}
