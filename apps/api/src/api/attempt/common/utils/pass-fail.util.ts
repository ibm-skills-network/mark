/**
 * Passing grade applied when an assignment leaves it unset. Mirrors the
 * column default in schema.prisma.
 */
export const DEFAULT_PASSING_GRADE = 50;

/**
 * Whether a 0–1 attempt grade meets the assignment's passing grade (an
 * integer percentage). An ungraded attempt never passes.
 *
 * The threshold is scaled down to the grade's 0–1 range rather than scaling
 * the grade up: `0.29 * 100` is 28.999999999999996, which would fail a
 * learner who scored exactly the passing grade.
 *
 * This is the single pass/fail comparison — answer-gating (ON_PASS) and the
 * pass/fail indicator must both use it so they can never disagree.
 */
export function meetsPassingGrade(
  grade: number | null | undefined,
  passingGrade: number | null | undefined,
): boolean {
  if (typeof grade !== "number") {
    return false;
  }
  return grade >= (passingGrade ?? DEFAULT_PASSING_GRADE) / 100;
}

/**
 * Pass/fail verdict for an attempt. Returns undefined when the pass/fail
 * indicator is disabled or the attempt has no grade, so callers can omit
 * the field from responses instead of leaking a default.
 */
export function resolvePassedIndicator(
  showPassFailIndicator: boolean | null | undefined,
  grade: number | null | undefined,
  passingGrade: number | null | undefined,
): boolean | undefined {
  if (!showPassFailIndicator || typeof grade !== "number") {
    return undefined;
  }
  return meetsPassingGrade(grade, passingGrade);
}
