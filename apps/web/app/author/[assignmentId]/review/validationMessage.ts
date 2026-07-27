/**
 * A validation failure belongs to a specific question exactly when the
 * validator names one in `invalidQuestionId`. Sniffing the message for words
 * like "question" misread every config error that happens to mention
 * questions ("Question order is required.", the Random Subset count) as
 * question-specific and hid it from the review screen's Configuration Error
 * panel.
 *
 * Naming a question is not the same as that question appearing in
 * `questionIssues`: the two run different checks (nothing in `questionIssues`
 * looks at variants, for instance), so a message pinned to a question the
 * per-question list never mentions still needs a panel of its own or it
 * renders nowhere at all.
 *
 * Both the issues modal and the button that opens it count issues off this,
 * so the modal's header total and the button's label always agree.
 */
export const validationMessageNeedsOwnPanel = (
  isValid: boolean,
  message: string,
  invalidQuestionId: number | null,
  questionIssues: Record<number, string[]>,
): boolean => {
  if (isValid || !message) return false;
  if (invalidQuestionId === null) return true;
  return (questionIssues[invalidQuestionId]?.length ?? 0) === 0;
};
