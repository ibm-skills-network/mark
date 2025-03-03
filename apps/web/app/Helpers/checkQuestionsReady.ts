import { useAssignmentConfig } from "@/stores/assignmentConfig";
import { useAuthorStore } from "@/stores/author";
import { useCallback, useEffect } from "react";
import { Question } from "../../config/types";
import { useDebugLog } from "../../lib/utils";

export const useQuestionsAreReadyToBePublished = (questions: Question[]) => {
  const debugLog = useDebugLog();
  const assignmentConfig = useAssignmentConfig((state) => state);
  const introduction = useAuthorStore((state) => state.introduction);
  const questionsAreReadyToBePublished = useCallback(() => {
    let isValid = true;
    let message = "";
    let step: number | null = null;
    const nonValidQuestionsIds: number[] = [];

    questions?.some((eachQuestion, index) => {
      const { type, question, choices, scoring, id } = eachQuestion;
      debugLog(`Checking question ${index + 1}:`, eachQuestion);

      if (!question?.trim()) {
        debugLog(`Question ${index + 1} has empty text.`);
        message = `Question ${index + 1} has empty text.`;
        step = 3;
        nonValidQuestionsIds.push(id);
        isValid = false;
        return true;
      }
      if (["URL", "TEXT", "UPLOAD", "LINK_FILE"].includes(type)) {
        if (
          (eachQuestion.variants?.length &&
            eachQuestion.variants?.some(
              (variant) =>
                !variant.scoring?.criteria?.some((criteria) =>
                  criteria.description?.trim(),
                ),
            )) ||
          eachQuestion.variants?.some(
            (variant) => !variant.variantContent?.trim(),
          )
        ) {
          nonValidQuestionsIds.push(id);
          debugLog(`Question ${index + 1} has missing or invalid variants.`);
          step = 3;
          message = `Question ${index + 1} has missing or invalid variants.`;
          isValid = false;
          return true;
        }
        const criteriaValid = scoring?.criteria?.every(
          (criteria) => criteria.description?.trim().length > 0,
        );
        if (!scoring?.criteria?.length || !criteriaValid) {
          nonValidQuestionsIds.push(id);
          debugLog(`Question ${index + 1} has missing or invalid criteria.`);
          step = 3;
          message = `Question ${index + 1} has missing or invalid criteria.`;
          isValid = false;
          return true;
        }
      }

      if (type === "TRUE_FALSE") {
        if (
          eachQuestion.variants?.length &&
          eachQuestion.variants?.some((variant) => {
            !variant.variantContent?.trim() ||
              variant.choices?.length !== 2 ||
              (Array.isArray(variant.choices) &&
                variant.choices.some(
                  (choice) => !choice.choice.trim() || choice.points <= 0,
                ));
          })
        ) {
          nonValidQuestionsIds.push(id);
          debugLog(`Question ${index + 1} has missing or invalid variants.`);
          step = 3;
          message = `Question ${index + 1} has missing or invalid variants.`;
          isValid = false;
          return true;
        }
        if (
          !choices ||
          choices?.some(
            (choice) => !choice.choice?.trim() || choice?.points <= 0,
          )
        ) {
          nonValidQuestionsIds.push(id);
          debugLog(`Question ${index + 1} has invalid True/False choices.`);
          step = 3;
          message = `Question ${index + 1} has invalid True/False choices.`;
          isValid = false;
          return true;
        }
      }

      if (["MULTIPLE_CORRECT", "SINGLE_CORRECT"].includes(type)) {
        // check their variants and choices
        if (
          eachQuestion.variants?.length &&
          eachQuestion.variants?.some(
            (variant) =>
              !variant.variantContent.trim() ||
              variant.choices?.length < 2 ||
              (Array.isArray(variant.choices) &&
                variant.choices.some((choice) => !choice.choice?.trim())),
          )
        ) {
          nonValidQuestionsIds.push(id);
          debugLog(`Question ${index + 1} has missing or invalid variants.`);
          step = 3;
          message = `Question ${index + 1} has missing or invalid variants.`;
          isValid = false;
          return true;
        }
        if (
          choices?.length < 2 ||
          choices?.some((choice) => !choice.choice?.trim()) ||
          !choices?.some((choice) => choice.isCorrect)
        ) {
          nonValidQuestionsIds.push(id);
          debugLog(
            `Question ${index + 1} is missing valid choices or correct answers.`,
          );
          message = `Question ${
            index + 1
          } is missing valid choices or correct answers.`;
          step = 3;
          isValid = false;
          return true;
        }
      }

      debugLog(`Question ${index + 1} passed all checks.`);
      return false; // Keep checking other questions
    });
    if (introduction?.trim() === "" || introduction?.trim() === "<p><br></p>") {
      debugLog(`Introduction is empty.`);
      message = `Introduction is empty.`;
      step = 1;
      isValid = false;
    }
    if (assignmentConfig.graded === null) {
      debugLog(`Assignment type is required.`);
      message = `Assignment type is required.`;
      step = 2;
      isValid = false;
    }
    if (!assignmentConfig.numAttempts || assignmentConfig.numAttempts < -1) {
      debugLog(`Please enter a valid number of attempts.`);
      message = `Please enter a valid number of attempts.`;
      step = 2;
      isValid = false;
    }
    if (
      assignmentConfig.passingGrade === undefined ||
      assignmentConfig.passingGrade <= 0 ||
      assignmentConfig.passingGrade > 100
    ) {
      debugLog(`Passing grade must be between 1 and 100.`);
      message = `Passing grade must be between 1 and 100.`;
      step = 2;
      isValid = false;
    }
    if (!assignmentConfig.displayOrder) {
      debugLog(`Question order is required.`);
      message = `Question order is required.`;
      step = 2;
      isValid = false;
    }
    if (!assignmentConfig.questionDisplay) {
      debugLog(`Question display type is required.`);
      message = `Question display type is required.`;
      step = 2;
      isValid = false;
    }
    return {
      isValid,
      message,
      step,
      invalidQuestionId: nonValidQuestionsIds.length
        ? nonValidQuestionsIds[0]
        : null,
    };
  }, [questions, debugLog]);

  return questionsAreReadyToBePublished;
};
