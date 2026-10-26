import type {
  QuestionAttemptRequestWithId,
  QuestionStore,
  SubmitResult,
} from "@/config/types";
import { isUnsupportedQuestion } from "@/lib/unsupported-questions";

/**
 * The response entries for a submit. Unsupported (recording/presentation)
 * questions get no entry: the API refuses an answer for them and does not
 * grade them.
 */
export function gradableQuestions(questions: QuestionStore[]): QuestionStore[] {
  return questions.filter((question) => !isUnsupportedQuestion(question));
}

/**
 * Store updates that attach each graded result to its question, so a preview
 * without a server-side attempt can render its results page from the store.
 * Hidden values stay null; the learner's own answer stays on the question.
 */
export function questionResultsFromSubmit(
  result: SubmitResult,
  responses: QuestionAttemptRequestWithId[],
  attemptId: number,
): Array<Pick<QuestionStore, "id" | "questionResponses">> {
  return result.feedbacksForQuestions.map((item) => ({
    id: item.questionId,
    questionResponses: [
      {
        id: item.id,
        questionId: item.questionId,
        assignmentAttemptId: attemptId,
        learnerAnswerChoice:
          responses.find((response) => response.id === item.questionId)
            ?.learnerAnswerChoice ?? undefined,
        points: item.totalPoints,
        feedback: item.feedback,
      },
    ],
  }));
}
