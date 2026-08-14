/**
 * Whether a 0–1 attempt grade meets the assignment's passing grade (an
 * integer percentage). Returns undefined when the pass/fail indicator is
 * disabled or the attempt has no grade, so callers can omit the field
 * from responses instead of leaking a default.
 */
export function resolvePassedIndicator(
  showPassFailIndicator: boolean | null | undefined,
  grade: number | null | undefined,
  passingGrade: number | null | undefined,
): boolean | undefined {
  if (!showPassFailIndicator || typeof grade !== "number") {
    return undefined;
  }
  return grade * 100 >= (passingGrade ?? 50);
}
