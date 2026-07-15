/**
 * Resolves a grade read back from the client store into a displayable value.
 *
 * A grade of 0 is a real result and must render as 0%. A null/undefined grade
 * means no grade was ever provided (e.g. the API withheld it, or nothing was
 * stored) — return NaN so the success page renders its hidden-score view
 * instead of a fake "0%" / "Failed".
 */
export function resolveStoreGrade(grade: number | null | undefined): number {
  return typeof grade === "number" ? grade : Number.NaN;
}

export type MissingGradeReason = "score-hidden" | "results-missing";

/**
 * Explains why there is no grade to display, so the empty state can be
 * honest. Only an explicit showAssignmentScore=false means the author hid
 * the score; anything else means the grade was simply lost — e.g. reloading
 * an author preview, whose results are never persisted — and blaming the
 * visibility setting would be misleading.
 */
export function resolveMissingGradeReason(
  showAssignmentScore: boolean | undefined,
): MissingGradeReason {
  return showAssignmentScore === false ? "score-hidden" : "results-missing";
}
