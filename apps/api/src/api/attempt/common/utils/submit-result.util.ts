import { CorrectAnswerVisibility } from "@prisma/client";
import { SubmitAssignmentAttemptResponseDto } from "src/api/assignment/attempt/dto/assignment-attempt/submit.assignment.attempt.response.dto";
import { CreateQuestionResponseAttemptResponseDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import { resolvePassedIndicator } from "./pass-fail.util";

export interface SubmitResultSettings {
  showAssignmentScore: boolean;
  showSubmissionFeedback: boolean;
  showQuestions: boolean;
  showQuestionScore: boolean;
  showPassFailIndicator: boolean;
  passingGrade: number | null;
  correctAnswerVisibility: CorrectAnswerVisibility | null | undefined;
}

/**
 * The learner-facing result of a graded submit. Each value the assignment
 * hides is null: the score and its totals behind showAssignmentScore, each
 * question's points behind showQuestionScore, feedback behind
 * showSubmissionFeedback. `passed` is computed from the real grade but only
 * sent when the pass/fail indicator is on.
 */
export const buildSubmitResult = (parameters: {
  attemptId: number;
  grade: number | null;
  totalPointsEarned: number;
  totalPossiblePoints: number;
  settings: SubmitResultSettings;
  responses: CreateQuestionResponseAttemptResponseDto[];
}): SubmitAssignmentAttemptResponseDto => {
  const {
    attemptId,
    grade,
    totalPointsEarned,
    totalPossiblePoints,
    settings,
    responses,
  } = parameters;
  const showScore = Boolean(settings.showAssignmentScore);
  const showQuestionScore = Boolean(settings.showQuestionScore);
  const showFeedback = Boolean(settings.showSubmissionFeedback);
  return {
    id: attemptId,
    submitted: true,
    grade: showScore ? grade : null,
    totalPointsEarned: showScore ? totalPointsEarned : null,
    totalPossiblePoints: showScore ? totalPossiblePoints : null,
    passed:
      resolvePassedIndicator(
        settings.showPassFailIndicator,
        grade,
        settings.passingGrade,
      ) ?? null,
    showAssignmentScore: showScore,
    showSubmissionFeedback: showFeedback,
    showQuestions: Boolean(settings.showQuestions),
    showQuestionScore,
    showPassFailIndicator: Boolean(settings.showPassFailIndicator),
    correctAnswerVisibility: settings.correctAnswerVisibility ?? "NEVER",
    feedbacksForQuestions: responses.map((response) => ({
      id: response.id,
      questionId: response.questionId,
      totalPoints:
        showQuestionScore && typeof response.totalPoints === "number"
          ? response.totalPoints
          : null,
      feedback:
        showFeedback && Array.isArray(response.feedback)
          ? response.feedback
          : null,
    })),
  };
};

/** The result for an attempt closed at its time limit: nothing is shown. */
export const closedAtTimeLimitResult = (
  attemptId: number,
): SubmitAssignmentAttemptResponseDto => ({
  id: attemptId,
  submitted: true,
  grade: null,
  totalPointsEarned: null,
  totalPossiblePoints: null,
  passed: null,
  showAssignmentScore: false,
  showSubmissionFeedback: false,
  showQuestions: false,
  showQuestionScore: false,
  showPassFailIndicator: false,
  correctAnswerVisibility: "NEVER",
  feedbacksForQuestions: [],
});
