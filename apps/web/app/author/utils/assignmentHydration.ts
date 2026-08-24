import type { Assignment, FeedbackData, GradingData } from "@/config/types";

// `showQuestions` / `showSubmissionFeedback` are intentionally emitted by both
// helpers below: the config store and the feedback store each own their own
// copy of these flags, so hydrating one must not leave the other stale. This is
// not a duplicate to be deduped away.
export function getAssignmentConfigHydration(
  assignment: Assignment,
): Partial<GradingData> & Pick<Assignment, "questionControls"> {
  return {
    numAttempts: assignment.numAttempts,
    retakeAttemptCoolDownMinutes: assignment.retakeAttemptCoolDownMinutes,
    attemptsBeforeCoolDown: assignment.attemptsBeforeCoolDown,
    passingGrade: assignment.passingGrade,
    displayOrder: assignment.displayOrder,
    graded: assignment.graded,
    questionDisplay: assignment.questionDisplay,
    questionVariationNumber: assignment.questionVariationNumber,
    timeEstimateMinutes: assignment.timeEstimateMinutes,
    allotedTimeMinutes: assignment.allotedTimeMinutes,
    showQuestions: assignment.showQuestions,
    showSubmissionFeedback: assignment.showSubmissionFeedback,
    requireAllQuestions: assignment.requireAllQuestions,
    optionalQuestionIds: assignment.optionalQuestionIds,
    numberOfQuestionsPerAttempt: assignment.numberOfQuestionsPerAttempt,
    questionControls: assignment.questionControls,
  };
}

export function getAssignmentFeedbackHydration(
  assignment: Assignment,
): Partial<FeedbackData> {
  return {
    showSubmissionFeedback: assignment.showSubmissionFeedback,
    showQuestionScore: assignment.showQuestionScore,
    showPassFailIndicator: assignment.showPassFailIndicator,
    showAssignmentScore: assignment.showAssignmentScore,
    showQuestions: assignment.showQuestions,
    correctAnswerVisibility: assignment.correctAnswerVisibility,
  };
}
