/**
 * Logical key of the in-flight grading lock for one learner attempt (or, with
 * a null attempt id, one author preview). JobStateService hashes it into the
 * Redis active-job pointer, so every caller that acquires or looks up the lock
 * must build it here.
 */
export function buildGradingActiveKey(
  userId: string,
  assignmentId: number,
  attemptId: number | null,
): string {
  return [
    "grading",
    userId,
    String(assignmentId),
    attemptId === null ? "author-preview" : String(attemptId),
  ].join(":");
}
