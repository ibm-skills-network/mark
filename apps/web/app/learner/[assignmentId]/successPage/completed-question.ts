import type {
  CompletedAttemptChoice,
  CompletedAttemptQuestion,
  QuestionStore,
} from "@/config/types";

/**
 * A preview attempt is never stored on the server, so its results page is
 * built from the learner store. This puts a store question into the shape the
 * completed-attempt read serves, applying the author's own correct-answer
 * setting the way the server does for a real attempt.
 */
export function completedQuestionFromStore(
  question: QuestionStore,
  options: { showCorrectAnswers: boolean },
): CompletedAttemptQuestion {
  const stored = question.questionResponses?.[0];
  const learnerResponse =
    (question.learnerChoices && question.learnerChoices.length > 0
      ? question.learnerChoices
      : undefined) ??
    question.learnerTextResponse ??
    question.learnerFileResponse ??
    question.learnerUrlResponse ??
    question.learnerAnswerChoice ??
    stored?.learnerResponse;

  const choices: CompletedAttemptChoice[] | null = Array.isArray(
    question.choices,
  )
    ? question.choices.map((choice, index) => {
        const id = (choice as { id?: unknown }).id;
        const base: CompletedAttemptChoice = {
          id: typeof id === "number" ? id : index,
          choice: choice.choice,
        };
        return options.showCorrectAnswers
          ? { ...base, isCorrect: choice.isCorrect, feedback: choice.feedback }
          : base;
      })
    : null;

  return {
    id: question.id,
    question: question.question ?? null,
    type: question.type,
    responseType: question.responseType ?? null,
    totalPoints: question.totalPoints,
    choices,
    scoring: question.scoring ?? null,
    response:
      stored || learnerResponse !== undefined
        ? {
            learnerResponse,
            points: stored ? stored.points : null,
            feedback: stored ? stored.feedback : null,
          }
        : null,
  };
}
