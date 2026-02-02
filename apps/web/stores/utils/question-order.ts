import { QuestionAuthorStore } from "@/config/types";

/**
 * Reorders questions based on a desired order while:
 * - removing duplicates
 * - ignoring invalid IDs
 * - appending any missing questions to the end
 * - normalizing indices to 1-based order
 */
export function applyQuestionOrder(
  questions: QuestionAuthorStore[],
  desiredOrder?: number[] | null,
): { questionOrder: number[]; questions: QuestionAuthorStore[] } {
  const sanitizedOrder = Array.isArray(desiredOrder)
    ? desiredOrder.filter((id): id is number => Number.isFinite(id))
    : [];

  const questionMap = new Map<number, QuestionAuthorStore>(
    questions.map((q) => [q.id, q]),
  );

  const orderedQuestions: QuestionAuthorStore[] = [];
  const seen = new Set<number>();

  for (const id of sanitizedOrder) {
    const question = questionMap.get(id);
    if (question && !seen.has(id)) {
      orderedQuestions.push({ ...question });
      seen.add(id);
    }
  }

  for (const question of questions) {
    if (!seen.has(question.id)) {
      orderedQuestions.push({ ...question });
      seen.add(question.id);
    }
  }

  const normalizedQuestions = orderedQuestions.map((q, index) => ({
    ...q,
    index: index + 1,
  }));

  const finalOrder = normalizedQuestions.map((q) => q.id);

  return {
    questionOrder: finalOrder,
    questions: normalizedQuestions,
  };
}
