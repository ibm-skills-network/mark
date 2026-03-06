import { processQuestions } from "@/app/Helpers/processQuestionsBeforePublish";
import { Choice, Criteria, QuestionAuthorStore } from "@/config/types";
import { generateTempQuestionId } from "@/lib/utils";

type MergeGeneratedQuestionsForAuthorStoreOptions = {
  existingQuestions: QuestionAuthorStore[];
  generatedQuestions: QuestionAuthorStore[];
  assignmentId: number;
  existingQuestionOrder?: number[];
  replaceExisting?: boolean;
};

type MergeGeneratedQuestionsForAuthorStoreResult = {
  processedQuestions: QuestionAuthorStore[];
  questions: QuestionAuthorStore[];
  generatedIds: number[];
  questionOrder: number[];
};

function getNumericQuestionIds(questions: QuestionAuthorStore[]): number[] {
  return questions
    .map((question) => question.id)
    .filter((id): id is number => typeof id === "number");
}

function getBaseQuestionOrder(
  baseQuestions: QuestionAuthorStore[],
  existingQuestionOrder?: number[],
): number[] {
  const baseIds = new Set(getNumericQuestionIds(baseQuestions));

  if (
    Array.isArray(existingQuestionOrder) &&
    existingQuestionOrder.length > 0
  ) {
    return existingQuestionOrder.filter((id) => baseIds.has(id));
  }

  return Array.from(baseIds);
}

/**
 * Normalize generated questions before inserting into the author store.
 * Preserves existing FileUploadModal behavior.
 */
export function normalizeGeneratedQuestionsForAuthorStore(
  generatedQuestions: QuestionAuthorStore[],
  assignmentId: number,
): QuestionAuthorStore[] {
  const normalizedQuestions = generatedQuestions.map((question) => {
    const normalizedChoices =
      question.choices && Array.isArray(question.choices)
        ? question.choices.map((choice: Choice, index: number) => ({
            ...choice,
            id: index,
          }))
        : question.choices;

    const totalPoints =
      question.scoring?.criteria && Array.isArray(question.scoring.criteria)
        ? Math.max(...question.scoring.criteria.map((c: Criteria) => c.points))
        : normalizedChoices
          ? normalizedChoices.reduce(
              (acc: number, choice: Choice) => acc + choice.points,
              0,
            )
          : 0;

    return {
      ...question,
      alreadyInBackend: false,
      id: generateTempQuestionId(),
      assignmentId,
      randomizedChoices: true,
      totalPoints,
      choices: normalizedChoices,
    };
  });

  return processQuestions(normalizedQuestions);
}

/**
 * Merge normalized generated questions into author-store state.
 * Keeps question order in sync for both button and chatbot generation flows.
 */
export function mergeGeneratedQuestionsForAuthorStore({
  existingQuestions,
  generatedQuestions,
  assignmentId,
  existingQuestionOrder,
  replaceExisting = false,
}: MergeGeneratedQuestionsForAuthorStoreOptions): MergeGeneratedQuestionsForAuthorStoreResult {
  const processedQuestions = normalizeGeneratedQuestionsForAuthorStore(
    generatedQuestions,
    assignmentId,
  );

  const baseQuestions = replaceExisting ? [] : existingQuestions;
  const baseQuestionOrder = replaceExisting
    ? []
    : getBaseQuestionOrder(baseQuestions, existingQuestionOrder);

  const generatedIds = getNumericQuestionIds(processedQuestions);
  const questionOrder = [...baseQuestionOrder];
  for (const generatedId of generatedIds) {
    if (!questionOrder.includes(generatedId)) {
      questionOrder.push(generatedId);
    }
  }

  return {
    processedQuestions,
    questions: [...baseQuestions, ...processedQuestions],
    generatedIds,
    questionOrder,
  };
}
