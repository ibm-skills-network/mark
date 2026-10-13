import type { Choice } from "src/api/assignment/dto/update.questions.request.dto";

/**
 * The text `value` becomes when read as a JSON number and written back
 * ("1.620" -> "1.62", "4.0" -> "4"), or undefined when it is not a JSON
 * number. This is exactly the rewrite older learner clients applied to
 * numeric-looking choice text before submitting it.
 */
export function jsonNumberForm(value: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "number" && Number.isFinite(parsed)
      ? JSON.stringify(parsed)
      : undefined;
  } catch {
    // Not JSON at all, so certainly not a JSON number.
    return undefined;
  }
}

export type NumericChoiceResolution =
  | { kind: "matched"; choice: Choice; index: number }
  | { kind: "ambiguous"; indexes: number[] }
  | { kind: "none" };

/**
 * Find the choice a submitted value was rewritten from. The submitted value
 * must already be in JSON number form (what the rewrite produces), and the
 * choice must rewrite to exactly that text. No rounding or numeric
 * tolerance: "1.62" never matches "1.620396". When two choices rewrite to the
 * same text ("4.0" and "4.00") the learner's pick cannot be known, so the
 * result is ambiguous and the caller must not award anything for it.
 */
export function resolveNumberRewrittenChoice(
  submitted: unknown,
  choices: Choice[],
): NumericChoiceResolution {
  let text: string;
  if (typeof submitted === "number" && Number.isFinite(submitted)) {
    text = JSON.stringify(submitted);
  } else if (typeof submitted === "string") {
    text = submitted.trim();
  } else {
    return { kind: "none" };
  }
  if (!text || jsonNumberForm(text) !== text) return { kind: "none" };

  const indexes: number[] = [];
  for (const [index, choice] of choices.entries()) {
    if (typeof choice?.choice !== "string") continue;
    const authored = choice.choice.trim();
    if (authored === text) continue;
    if (jsonNumberForm(authored) === text) indexes.push(index);
  }

  if (indexes.length === 0) return { kind: "none" };
  if (indexes.length > 1) return { kind: "ambiguous", indexes };
  return { kind: "matched", choice: choices[indexes[0]], index: indexes[0] };
}
