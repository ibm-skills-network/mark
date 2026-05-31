export interface ChoiceLike {
  choice: string;
}

/**
 * Resolve which choice positions a learner's stored MCQ answer refers to.
 *
 * A learner's stored answer is the choice *text* (the answering UI converts the
 * selected index to text before saving, and the API grades by text). Some older
 * attempts stored the positional index instead. We resolve by text first and
 * only fall back to a positional index when no choice text matches — otherwise a
 * numeric answer like "3" would also light up whichever choice happens to sit at
 * index 3, showing two selections for a single-answer question.
 */
export function getSelectedChoiceIndexes(
  learnerResponse: string | string[] | undefined | null,
  choices: ChoiceLike[],
): Set<number> {
  const responses =
    learnerResponse === undefined || learnerResponse === null
      ? []
      : Array.isArray(learnerResponse)
        ? learnerResponse
        : [String(learnerResponse)];

  const selected = new Set<number>();
  for (const ans of responses) {
    // Prefer matching by choice text. Mark every choice whose text equals the
    // answer (duplicate choice texts are indistinguishable to the learner).
    let matchedByText = false;
    choices.forEach((choiceObj, index) => {
      if (choiceObj.choice === ans) {
        selected.add(index);
        matchedByText = true;
      }
    });
    if (matchedByText) continue;

    // Legacy fallback: older attempts stored the positional index as a string.
    // Only reached when the answer matches no choice text, so a numeric answer
    // never doubles as an index into the choice list.
    if (/^\d+$/.test(ans)) {
      const index = Number(ans);
      if (index >= 0 && index < choices.length) {
        selected.add(index);
      }
    }
  }
  return selected;
}
