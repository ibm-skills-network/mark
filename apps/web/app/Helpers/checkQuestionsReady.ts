import { useAssignmentConfig } from "@/stores/assignmentConfig";
import { useAuthorStore } from "@/stores/author";
import { useCallback } from "react";
import type {
  Choice,
  Question,
  QuestionType,
  QuestionVariants,
  Scoring,
} from "../../config/types";
import { useDebugLog } from "../../lib/utils";

interface ValidationError {
  message: string;
  step: number;
}

export interface ValidationResult {
  isValid: boolean;
  message: string;
  step: number | null;
  invalidQuestionId: number | null;
}
const textTypes = new Set(["TEXT", "URL", "UPLOAD", "LINK_FILE"]);
const choiceTypes = new Set(["SINGLE_CORRECT", "MULTIPLE_CORRECT"]);
/**
 * Hook that validates whether the provided questions are ready to be published.
 * It returns a function that returns a ValidationResult.
 */
export const useQuestionsAreReadyToBePublished = (
  questions: Question[],
): (() => ValidationResult) => {
  const debugLog = useDebugLog();
  const assignmentConfig = useAssignmentConfig((state) => state);
  const introduction = useAuthorStore((state) => state.introduction);

  const validateBasicFields = (
    q: Question,
    index: number,
  ): ValidationError | null => {
    if (!q.question?.trim()) {
      return { message: `Question ${index + 1} text is empty.`, step: 0 };
    }
    if (!q.type?.trim()) {
      return { message: `Question ${index + 1} type is missing.`, step: 0 };
    }
    if (q.totalPoints == null) {
      return {
        message: `Question ${index + 1} total points are missing.`,
        step: 0,
      };
    }
    if (q.assignmentId == null) {
      return {
        message: `Question ${index + 1} assignment ID is missing.`,
        step: 0,
      };
    }
    return null;
  };

  const validateChoices = (
    choices: Choice[] | undefined,
    index: number,
    type: QuestionType,
  ): ValidationError | null => {
    if (!choices || !Array.isArray(choices) || choices.length === 0) {
      return { message: `Question ${index + 1} has no choices.`, step: 0 };
    }
    if (choiceTypes.has(type) && choices.length < 2) {
      return {
        message: `Question ${index + 1} must have at least 2 choices.`,
        step: 0,
      };
    }
    for (let i = 0; i < choices.length; i++) {
      const { choice: choiceText, points } = choices[i];
      if (!choiceText?.trim()) {
        return {
          message: `Question ${index + 1} has an empty choice text.`,
          step: 0,
        };
      }
      if (
        points === undefined ||
        points === null ||
        typeof points !== "number"
      ) {
        return {
          message: `Question ${index + 1} has a choice with invalid points.`,
          step: 0,
        };
      }
    }
    if (choiceTypes.has(type)) {
      if (!choices.some((choice) => choice.isCorrect)) {
        return {
          message: `Question ${
            index + 1
          } must have at least one correct choice.`,
          step: 0,
        };
      }
    }
    return null;
  };

  const validateScoring = (
    scoring: Scoring | undefined,
    index: number,
  ): ValidationError | null => {
    if (!scoring) {
      return {
        message: `Question ${index + 1} requires scoring configuration.`,
        step: 0,
      };
    }
    if (
      !scoring.rubrics ||
      !Array.isArray(scoring.rubrics) ||
      scoring.rubrics.length === 0
    ) {
      return {
        message: `Question ${index + 1} scoring rubrics are missing.`,
        step: 0,
      };
    }
    for (let r = 0; r < scoring.rubrics.length; r++) {
      const rubric = scoring.rubrics[r];
      if (!rubric?.rubricQuestion?.trim()) {
        return {
          message: `Question ${index + 1} rubric ${r + 1} question is empty.`,
          step: 0,
        };
      }
      if (
        !rubric.criteria ||
        !Array.isArray(rubric.criteria) ||
        rubric.criteria.length === 0
      ) {
        return {
          message: `Question ${index + 1} rubric ${
            r + 1
          } criteria are missing.`,
          step: 0,
        };
      }
      for (let c = 0; c < rubric.criteria.length; c++) {
        const crit = rubric.criteria[c];
        if (!crit.description?.trim()) {
          return {
            message: `Question ${index + 1} rubric ${r + 1} criteria ${
              c + 1
            } description is empty.`,
            step: 0,
          };
        }
        if (
          crit.points === undefined ||
          crit.points === null ||
          typeof crit.points !== "number"
        ) {
          return {
            message: `Question ${index + 1} rubric ${r + 1} criteria ${
              c + 1
            } points are invalid.`,
            step: 0,
          };
        }
      }
    }
    return null;
  };

  const validateVariants = (
    variants: QuestionVariants[],
    qType: QuestionType,
    index: number,
  ): ValidationError | null => {
    for (let v = 0; v < variants.length; v++) {
      const variant = variants[v];
      if (!variant.variantContent?.trim()) {
        return {
          message: `Question ${index + 1} variant ${v + 1} content is empty.`,
          step: 0,
        };
      }
      if (variant.scoring === undefined && textTypes.has(qType)) {
        return {
          message: `Question ${index + 1} variant ${v + 1} scoring is required.`,
          step: 0,
        };
      }
      if (variant.scoring && textTypes.has(qType)) {
        const scoringError = validateScoring(variant.scoring, index);
        if (scoringError) {
          return scoringError;
        }
      }
      if (
        (variant.choices && choiceTypes.has(qType)) ||
        qType === "TRUE_FALSE"
      ) {
        if (!Array.isArray(variant.choices)) {
          return {
            message: `Question ${index + 1} variant ${
              v + 1
            } choices are not in the correct format.`,
            step: 0,
          };
        }
        if (qType === "TRUE_FALSE" && variant.choices.length !== 1) {
          return {
            message: `Question ${index + 1} variant ${
              v + 1
            } must have exactly 1 choices.`,
            step: 0,
          };
        }
        const choiceError = validateChoices(variant.choices, index, qType);
        if (choiceError) {
          return choiceError;
        }
      }
    }
    return null;
  };

  const questionsAreReadyToBePublished = useCallback((): ValidationResult => {
    let isValid = true;
    let message = "";
    let step: number | null = null;
    let invalidQuestionId: number | null = null;
    const textTypes = new Set(["TEXT", "URL", "UPLOAD", "LINK_FILE"]);
    const choiceTypes = new Set(["SINGLE_CORRECT", "MULTIPLE_CORRECT"]);

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      debugLog(`Checking question ${i + 1}:`, q);

      const basicError = validateBasicFields(q, i);
      if (basicError) {
        message = basicError.message;
        step = basicError.step;
        invalidQuestionId = q.id;
        isValid = false;
        break;
      }

      if (choiceTypes.has(q.type) || q.type === "TRUE_FALSE") {
        const choiceError = validateChoices(q.choices, i, q.type);
        if (choiceError) {
          message = choiceError.message;
          step = choiceError.step;
          invalidQuestionId = q.id;
          isValid = false;
          break;
        }
      }

      if (textTypes.has(q.type) && q.scoring) {
        const scoringError = validateScoring(q.scoring, i);
        if (scoringError) {
          message = scoringError.message;
          step = scoringError.step;
          invalidQuestionId = q.id;
          isValid = false;
          break;
        }
      }

      if (q.variants && Array.isArray(q.variants) && q.variants.length > 0) {
        const variantError = validateVariants(q.variants, q.type, i);
        if (variantError) {
          message = variantError.message;
          step = variantError.step;
          invalidQuestionId = q.id;
          isValid = false;
          break;
        }
      }

      debugLog(`Question ${i + 1} passed all checks.`);
    }

    if (isValid) {
      if (!introduction?.trim() || introduction.trim() === "<p><br></p>") {
        message = `Introduction is empty.`;
        debugLog(message);
        step = 3;
        isValid = false;
      }
      if (assignmentConfig.graded === null) {
        message = `Assignment type is required.`;
        debugLog(message);
        step = 1;
        isValid = false;
      }
      if (
        assignmentConfig.numAttempts == null ||
        assignmentConfig.numAttempts < -1
      ) {
        message = `Please enter a valid number of attempts.`;
        debugLog(message);
        step = 1;
        isValid = false;
      }
      if (
        assignmentConfig.passingGrade == null ||
        assignmentConfig.passingGrade <= 0 ||
        assignmentConfig.passingGrade > 100
      ) {
        message = `Passing grade must be between 1 and 100.`;
        debugLog(message);
        step = 1;
        isValid = false;
      }
      if (
        !assignmentConfig.displayOrder &&
        assignmentConfig.numberOfQuestionsPerAttempt === null
      ) {
        message = `Question order is required.`;
        debugLog(message);
        step = 1;
        isValid = false;
      }
      if (!assignmentConfig.questionDisplay) {
        message = `Question display type is required.`;
        debugLog(message);
        step = 1;
        isValid = false;
      }
    }

    return {
      isValid,
      message,
      step,
      invalidQuestionId,
    };
  }, [questions, debugLog, assignmentConfig, introduction]);

  return questionsAreReadyToBePublished;
};
