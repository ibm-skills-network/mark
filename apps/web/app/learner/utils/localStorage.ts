/**
 * Clears localStorage entries related to a specific assignment when starting a NEW attempt.
 * This prevents "exceeded quota" errors by removing old assignment data.
 *
 * @param assignmentId - The ID of the assignment
 */
export function clearAssignmentLocalStorage(assignmentId: number): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const keysToRemove: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      if (
        key === `learner-${assignmentId}` ||
        key === `learner-overview-${assignmentId}` ||
        key === "assignmentDetails" ||
        key === "assignmentConfig" ||
        key === "assignmentFeedbackConfig" ||
        key === "github-store" ||
        key === "video-recorder-store" ||
        key === `assignment-${assignmentId}-author`
      ) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((key) => {
      localStorage.removeItem(key);
    });
  } catch (error) {
    console.error("[localStorage] Error clearing localStorage:", error);
  }
}
