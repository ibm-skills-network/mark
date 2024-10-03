import { useCallback } from "react";
import { Question } from "../../config/types";
import { useDebugLog } from "../../lib/utils";

export const useQuestionsAreReadyToBePublished = (questions: Question[]) => {
  const debugLog = useDebugLog();

  const questionsAreReadyToBePublished = useCallback(() => {
    let isValid = true;
    let message = "";
    const nonValidQuestionsIds: number[] = [];

    questions.some((eachQuestion, index) => {
      const { type, question, choices, scoring, id } = eachQuestion;
      debugLog(`Checking question ${index + 1}:`, eachQuestion);

      if (!question?.trim()) {
        debugLog(`Question ${index + 1} has empty text.`);
        message = `Question ${index + 1} has empty text.`;
        nonValidQuestionsIds.push(id);
        isValid = false;
        return true; // Continue to the next question, but mark this as invalid
      }

      if (["URL", "TEXT"].includes(type)) {
        const criteriaValid = scoring?.criteria?.every(
          (criteria) => criteria.description.trim().length > 0,
        );
        if (!scoring?.criteria?.length || !criteriaValid) {
          nonValidQuestionsIds.push(id);
          debugLog(`Question ${index + 1} has missing or invalid criteria.`);
          message = `Question ${index + 1} has missing or invalid criteria.`;
          isValid = false;
          return true;
        }
      }

      if (type === "TRUE_FALSE") {
        if (
          !choices ||
          choices?.some((choice) => !choice.choice.trim() || choice.points <= 0)
        ) {
          nonValidQuestionsIds.push(id);
          debugLog(`Question ${index + 1} has invalid True/False choices.`);
          message = `Question ${index + 1} has invalid True/False choices.`;
          isValid = false;
          return true;
        }
      }

      if (["MULTIPLE_CORRECT", "SINGLE_CORRECT"].includes(type)) {
        if (
          choices?.length < 2 ||
          choices?.some((choice) => !choice.choice.trim()) ||
          !choices?.some((choice) => choice.isCorrect)
        ) {
          nonValidQuestionsIds.push(id);
          debugLog(
            `Question ${index + 1} is missing valid choices or correct answers.`,
          );
          message = `Question ${
            index + 1
          } is missing valid choices or correct answers.`;
          isValid = false;
          return true;
        }
      }

      debugLog(`Question ${index + 1} passed all checks.`);
      return false; // Keep checking other questions
    });

    return {
      isValid,
      message,
      invalidQuestionId: nonValidQuestionsIds.length
        ? nonValidQuestionsIds[0]
        : null,
    };
  }, [questions, debugLog]);

  return questionsAreReadyToBePublished;
};
