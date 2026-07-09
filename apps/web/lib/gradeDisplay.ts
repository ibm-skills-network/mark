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
