/**
 * Warning copy for a Random Subset count the question pool can no longer
 * satisfy, or null when the count is fine.
 *
 * Publishing does not fail on this — the server folds the count down to the
 * pool and persists the corrected value — so the author gets a heads-up
 * rather than a block. Assignments authored before the input was capped, and
 * any assignment whose questions were deleted after the count was set, land
 * here.
 *
 * Kept in lockstep with clampQuestionsPerAttempt on the API side: an empty
 * pool clears the setting instead of clamping to zero, because there is no
 * positive count that describes "no questions to draw from".
 */
export const describeQuestionsPerAttemptClamp = (
  numberOfQuestionsPerAttempt: number | null | undefined,
  activeQuestionCount: number,
): string | null => {
  if (
    typeof numberOfQuestionsPerAttempt !== "number" ||
    numberOfQuestionsPerAttempt <= 0 ||
    numberOfQuestionsPerAttempt <= activeQuestionCount
  ) {
    return null;
  }

  if (activeQuestionCount === 0) {
    return `This assignment has no questions left, so publishing will clear the Random Subset setting.`;
  }

  if (activeQuestionCount === 1) {
    return `This assignment has only 1 question, so publishing will lower this to 1 and every attempt will show it.`;
  }

  return `This assignment has only ${activeQuestionCount} questions, so publishing will lower this to ${activeQuestionCount} and every attempt will show all of them.`;
};
