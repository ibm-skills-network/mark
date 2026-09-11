import { getStoredData } from "@/app/Helpers/getStoredDataFromLocal";
import { processQuestions } from "@/app/Helpers/processQuestionsBeforePublish";
import type {
  Assignment,
  AssignmentDetails,
  QuestionAuthorStore,
  QuestionStore,
} from "@/config/types";

export type AuthorPreviewPayload = {
  assignmentDetails: AssignmentDetails;
  questions: QuestionStore[];
};

const isMatchingAssignment = (
  assignmentDetails: Partial<AssignmentDetails> | null | undefined,
  assignmentId: number,
) =>
  assignmentDetails?.id === assignmentId &&
  typeof assignmentDetails.name === "string" &&
  assignmentDetails.name.length > 0;

export function readAuthorPreviewPayload(
  assignmentId: number,
): AuthorPreviewPayload | null {
  const assignmentDetails = getStoredData<AssignmentDetails | null>(
    "assignmentConfig",
    null,
  );
  const questions = getStoredData<QuestionStore[]>("questions", []);

  if (
    !assignmentDetails ||
    !isMatchingAssignment(assignmentDetails, assignmentId) ||
    !Array.isArray(questions)
  ) {
    return null;
  }

  // Older/incomplete settings must not discard unsaved overview text or questions.
  return {
    assignmentDetails: {
      ...assignmentDetails,
      displayOrder:
        assignmentDetails.displayOrder === "RANDOM" ? "RANDOM" : "DEFINED",
      strictTimeLimit:
        assignmentDetails.strictTimeLimit ??
        (assignmentDetails.allotedTimeMinutes ?? 0) > 0,
      introduction: assignmentDetails.introduction ?? "",
      instructions: assignmentDetails.instructions ?? "",
    },
    questions,
  };
}

export function buildAuthorPreviewPayload(
  assignment: Assignment,
): AuthorPreviewPayload {
  const processedQuestions = processQuestions(
    (assignment.questions ?? []) as QuestionAuthorStore[],
  ) as unknown as QuestionStore[];

  return {
    assignmentDetails: {
      id: assignment.id,
      name: assignment.name,
      introduction: assignment.introduction ?? "",
      instructions: assignment.instructions ?? "",
      gradingCriteriaOverview: assignment.gradingCriteriaOverview,
      graded: assignment.graded,
      numAttempts: assignment.numAttempts,
      attemptsBeforeCoolDown: assignment.attemptsBeforeCoolDown,
      retakeAttemptCoolDownMinutes: assignment.retakeAttemptCoolDownMinutes,
      allotedTimeMinutes: assignment.allotedTimeMinutes,
      timeEstimateMinutes: assignment.timeEstimateMinutes,
      passingGrade: assignment.passingGrade,
      displayOrder: assignment.displayOrder ?? "DEFINED",
      // Persisted assignments represent the time limit through allotted minutes.
      strictTimeLimit: (assignment.allotedTimeMinutes ?? 0) > 0,
      questionDisplay: assignment.questionDisplay,
      numberOfQuestionsPerAttempt: assignment.numberOfQuestionsPerAttempt,
      requireAllQuestions: assignment.requireAllQuestions,
      optionalQuestionIds: assignment.optionalQuestionIds,
      published: assignment.published,
      questionOrder: assignment.questionOrder,
      showQuestions: assignment.showQuestions,
      showAssignmentScore: assignment.showAssignmentScore,
      showQuestionScore: assignment.showQuestionScore,
      showPassFailIndicator: assignment.showPassFailIndicator,
      showSubmissionFeedback: assignment.showSubmissionFeedback,
      correctAnswerVisibility: assignment.correctAnswerVisibility,
      questionControls: assignment.questionControls,
      updatedAt: assignment.updatedAt,
    },
    questions: processedQuestions,
  };
}
