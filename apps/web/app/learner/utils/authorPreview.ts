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
    !isMatchingAssignment(assignmentDetails, assignmentId) ||
    !Array.isArray(questions)
  ) {
    return null;
  }

  return { assignmentDetails, questions };
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
      introduction: assignment.introduction,
      instructions: assignment.instructions,
      gradingCriteriaOverview: assignment.gradingCriteriaOverview,
      graded: assignment.graded,
      numAttempts: assignment.numAttempts,
      attemptsBeforeCoolDown: assignment.attemptsBeforeCoolDown,
      retakeAttemptCoolDownMinutes: assignment.retakeAttemptCoolDownMinutes,
      allotedTimeMinutes: assignment.allotedTimeMinutes,
      timeEstimateMinutes: assignment.timeEstimateMinutes,
      passingGrade: assignment.passingGrade,
      displayOrder: assignment.displayOrder,
      questionDisplay: assignment.questionDisplay,
      numberOfQuestionsPerAttempt: assignment.numberOfQuestionsPerAttempt,
      requireAllQuestions: assignment.requireAllQuestions,
      optionalQuestionIds: assignment.optionalQuestionIds,
      published: assignment.published,
      questionOrder: assignment.questionOrder,
      showQuestions: assignment.showQuestions,
      showAssignmentScore: assignment.showAssignmentScore,
      showQuestionScore: assignment.showQuestionScore,
      showSubmissionFeedback: assignment.showSubmissionFeedback,
      correctAnswerVisibility: assignment.correctAnswerVisibility,
      questionControls: assignment.questionControls,
      updatedAt: assignment.updatedAt,
    },
    questions: processedQuestions,
  };
}
