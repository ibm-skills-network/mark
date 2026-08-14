import { Choice } from "../dto/update.questions.request.dto";

export interface ResolvedTrueFalseAnswer {
  correctAnswer: boolean;
  /** Points carried by the choice that is actually correct. */
  correctPoints: number;
}

function labelOf(choice?: Choice): string | undefined {
  return typeof choice?.choice === "string"
    ? choice.choice.trim().toLowerCase()
    : undefined;
}

/**
 * Resolve which boolean a TRUE_FALSE question accepts, and what it is worth.
 *
 * The correct answer belongs to the choice flagged `isCorrect` — never to a
 * fixed position. TF choices are stored `[True, False]`, so any logic keyed
 * on `choices[0]` silently treats True as the answer to every question and
 * inverts grading for the half of the bank authored with False correct.
 * Points must come from that same choice: the True row carries 0 points
 * whenever False is the answer.
 *
 * Returns null when there are no choices to resolve against — callers decide
 * how to refuse the grade.
 */
export function resolveTrueFalseAnswer(
  choices: Choice[] | undefined | null,
): ResolvedTrueFalseAnswer | null {
  const list = Array.isArray(choices) ? choices : [];
  if (list.length === 0) {
    return null;
  }

  const correctChoice = list.find((choice) => choice?.isCorrect === true);
  if (!correctChoice) {
    // Legacy data with no flagged choice: fall back to reading the first
    // label, which is all the information the row carries.
    return {
      correctAnswer: labelOf(list[0]) === "true",
      correctPoints: list[0]?.points ?? 0,
    };
  }

  const label = labelOf(correctChoice);
  const correctAnswer =
    label === "true" || label === "false"
      ? label === "true"
      : // Unparseable label (null, localized, numeric): authoring stores
        // the True choice first, so position is the remaining signal.
        list.indexOf(correctChoice) === 0;

  return { correctAnswer, correctPoints: correctChoice.points ?? 0 };
}
