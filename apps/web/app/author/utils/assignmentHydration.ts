import type { Assignment, FeedbackData, GradingData } from "@/config/types";

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
    showAssignmentScore: assignment.showAssignmentScore,
    showQuestions: assignment.showQuestions,
    correctAnswerVisibility: assignment.correctAnswerVisibility,
  };
}
