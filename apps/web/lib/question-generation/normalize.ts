import { processQuestions } from "@/app/Helpers/processQuestionsBeforePublish";
import { Choice, Criteria, QuestionAuthorStore } from "@/config/types";
import { generateTempQuestionId } from "@/lib/utils";

/**
 * Normalize generated questions before inserting into the author store.
 * Preserves existing FileUploadModal behavior.
 */
export function normalizeGeneratedQuestionsForAuthorStore(
  generatedQuestions: QuestionAuthorStore[],
  assignmentId: number,
): QuestionAuthorStore[] {
  generatedQuestions.forEach((question: QuestionAuthorStore) => {
    question.alreadyInBackend = false;
    question.id = generateTempQuestionId();
    question.assignmentId = assignmentId;
    question.randomizedChoices = true;
    question.totalPoints =
      question.scoring?.criteria && Array.isArray(question.scoring.criteria)
        ? Math.max(...question.scoring.criteria.map((c: Criteria) => c.points))
        : question.choices
          ? question.choices.reduce(
              (acc: number, choice: Choice) => acc + choice.points,
              0,
            )
          : 0;

    if (question.choices && Array.isArray(question.choices)) {
      question.choices = question.choices.map(
        (choice: Choice, index: number) => ({
          ...choice,
          id: index,
        }),
      );
    }
  });

  return processQuestions(generatedQuestions);
}
