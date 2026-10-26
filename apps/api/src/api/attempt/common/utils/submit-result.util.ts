import { CorrectAnswerVisibility } from "@prisma/client";
import { SubmitAssignmentAttemptResponseDto } from "src/api/assignment/attempt/dto/assignment-attempt/submit.assignment.attempt.response.dto";
import { CreateQuestionResponseAttemptResponseDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import { applyAnswerKeyVisibility } from "./correct-options-feedback.util";
import { meetsPassingGrade, resolvePassedIndicator } from "./pass-fail.util";

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
 * sent when the pass/fail indicator is on. With showQuestions off no
 * per-question entry is sent at all. Multiple-correct and true/false feedback
 * names the correct answer only when the answer key is revealed.
 */
export const buildSubmitResult = (parameters: {
  attemptId: number;
  grade: number | null;
  totalPointsEarned: number;
  totalPossiblePoints: number;
  settings: SubmitResultSettings;
  responses: CreateQuestionResponseAttemptResponseDto[];
  /** The language the submit was graded in. */
  language?: string;
}): SubmitAssignmentAttemptResponseDto => {
  const {
    attemptId,
    grade,
    totalPointsEarned,
    totalPossiblePoints,
    settings,
    responses,
    language,
  } = parameters;
  const showScore = Boolean(settings.showAssignmentScore);
  const showQuestionScore = Boolean(settings.showQuestionScore);
  const showFeedback = Boolean(settings.showSubmissionFeedback);
  const showQuestions = Boolean(settings.showQuestions);
  const revealAnswers = answersRevealed(
    settings.correctAnswerVisibility,
    grade,
    settings.passingGrade,
  );
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
    showQuestions,
    showQuestionScore,
    showPassFailIndicator: Boolean(settings.showPassFailIndicator),
    correctAnswerVisibility: settings.correctAnswerVisibility ?? "NEVER",
    feedbacksForQuestions: showQuestions
      ? responses.map((response) => ({
          id: response.id,
          questionId: response.questionId,
          totalPoints:
            showQuestionScore && typeof response.totalPoints === "number"
              ? response.totalPoints
              : null,
          feedback:
            showFeedback && Array.isArray(response.feedback)
              ? visibleFeedback(response, revealAnswers, language)
              : null,
        }))
      : [],
  };
};

/** The same answer-key rule the completed-attempt read applies. */
const answersRevealed = (
  visibility: CorrectAnswerVisibility | null | undefined,
  grade: number | null,
  passingGrade: number | null,
): boolean => {
  if (visibility === "ALWAYS") return true;
  if (visibility === "ON_PASS") return meetsPassingGrade(grade, passingGrade);
  return false;
};

type StoredFeedback = CreateQuestionResponseAttemptResponseDto["feedback"];

/**
 * The grader's own metadata says which answer-key sentence applies:
 * multiple-correct responses carry `perfectScore`/`correctChoices`,
 * true/false responses `isCorrect`/`correctAnswer`.
 */
const visibleFeedback = (
  response: CreateQuestionResponseAttemptResponseDto,
  revealAnswers: boolean,
  language: string | undefined,
): StoredFeedback => {
  const metadata: Record<string, unknown> | undefined = response.metadata;
  // Entries keep their shape; only their `feedback` text changes.
  return applyAnswerKeyVisibility(response.feedback, metadata, {
    revealAnswers,
    language,
    isTrueFalse: typeof metadata?.correctAnswer === "boolean",
    isMultipleCorrect: typeof metadata?.perfectScore === "boolean",
  }) as StoredFeedback;
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
