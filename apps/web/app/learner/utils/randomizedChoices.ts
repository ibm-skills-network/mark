/** A choice as the attempt read serves it: sanitised to id + text. */
export interface AttemptChoice {
  id: number | null;
  choice: string;
}

const isAttemptChoice = (value: unknown): value is AttemptChoice =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { choice?: unknown }).choice === "string";

/**
 * Normalises an attempt question's `randomizedChoices` (the frozen choice
 * order). The server sends an array or null; older responses sent the same
 * array as a JSON string, which is still accepted. Anything else, including an
 * unparsable string or a non-array, is treated as null.
 */
export function parseRandomizedChoices(value: unknown): AttemptChoice[] | null {
  let candidate: unknown = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate) as unknown;
    } catch (error) {
      console.warn("Ignoring unparsable randomizedChoices string", error);
      return null;
    }
  }
  if (!Array.isArray(candidate)) {
    return null;
  }
  return candidate.filter(isAttemptChoice).map((item) => ({
    id: typeof item.id === "number" ? item.id : null,
    choice: item.choice,
  }));
}
