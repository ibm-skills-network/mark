/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/require-await */
import { Injectable } from "@nestjs/common";
import { GradingGraphState } from "../graph/state";
import { ValidatedGradeSchema } from "../schemas/zod-schemas";

@Injectable()
export class ValidateNode {
  async execute(state: GradingGraphState): Promise<GradingGraphState> {
    if (!state.graderResult) {
      return {
        ...state,
        errors: [...state.errors, "No grader result to validate"],
        shouldContinue: false,
        currentStep: "error",
      };
    }

    try {
      const validationResult = this.validateGrade(state.graderResult);

      if (validationResult.isValid) {
        return {
          ...state,
          graderResult: validationResult,
          currentStep: "evidence",
          shouldContinue: true,
        };
      }

      if (state.retry_count < 2) {
        return {
          ...state,
          graderResult: validationResult,
          retry_count: state.retry_count + 1,
          currentStep: "grade",
          shouldContinue: true,
        };
      }

      return {
        ...state,
        graderResult: validationResult,
        errors: [
          ...state.errors,
          `Validation failed after retries: ${validationResult.validationErrors.join(
            ", ",
          )}`,
        ],
        shouldContinue: false,
        currentStep: "error",
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown validation error";

      return {
        ...state,
        errors: [...state.errors, `Validation error: ${errorMessage}`],
        shouldContinue: false,
        currentStep: "error",
      };
    }
  }

  private validateGrade(grade: GradingGraphState["graderResult"]) {
    const validationErrors: string[] = [];
    let arithmeticFixed = false;

    if (!grade) {
      throw new Error("No grade to validate");
    }

    const calculatedTotal = grade.criteriaAwards.reduce(
      (sum, award) => sum + award.awarded,
      0,
    );
    const calculatedMax = grade.criteriaAwards.reduce(
      (sum, award) => sum + award.maxPoints,
      0,
    );

    if (Math.abs(calculatedTotal - grade.totalAwarded) > 0.01) {
      grade.totalAwarded = calculatedTotal;
      arithmeticFixed = true;
    }

    if (Math.abs(calculatedMax - grade.totalMax) > 0.01) {
      grade.totalMax = calculatedMax;
      arithmeticFixed = true;
    }

    for (const award of grade.criteriaAwards) {
      if (award.awarded < 0) {
        award.awarded = 0;
        arithmeticFixed = true;
        validationErrors.push(
          `Negative score clamped to 0 for criterion ${award.criterionId}`,
        );
      }

      if (award.awarded > award.maxPoints) {
        award.awarded = award.maxPoints;
        arithmeticFixed = true;
        validationErrors.push(
          `Score clamped to max for criterion ${award.criterionId}`,
        );
      }

      if (!award.justification || award.justification.trim().length === 0) {
        validationErrors.push(
          `Missing justification for criterion ${award.criterionId}`,
        );
      }

      if (award.justification && award.justification.length > 500) {
        validationErrors.push(
          `Justification too long for criterion ${award.criterionId}`,
        );
      }
    }

    if (grade.confidence < 0 || grade.confidence > 1) {
      grade.confidence = Math.max(0, Math.min(1, grade.confidence));
      arithmeticFixed = true;
    }

    if (grade.overallFeedback && grade.overallFeedback.length > 1000) {
      validationErrors.push("Overall feedback too long");
    }

    try {
      ValidatedGradeSchema.parse({
        ...grade,
        isValid: validationErrors.length === 0,
        validationErrors,
        arithmeticFixed,
      });
    } catch (zodError) {
      validationErrors.push(
        `Schema validation failed: ${
          zodError instanceof Error ? zodError.message : String(zodError)
        }`,
      );
    }

    return {
      ...grade,
      isValid: validationErrors.length === 0,
      validationErrors,
      arithmeticFixed,
    };
  }
}
