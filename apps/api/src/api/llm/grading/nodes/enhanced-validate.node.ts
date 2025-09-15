/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/restrict-plus-operands */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from "@nestjs/common";
import {
  addError,
  determineFallbackStrategy,
  GradingGraphState,
  isNodeCircuitBreakerOpen,
  recordNodeExecution,
  shouldAbortProcessing,
  updateCircuitBreaker,
} from "../graph/state";
import { ValidatedGradeSchema } from "../schemas/zod-schemas";

interface ValidationConfig {
  strictMode: boolean;
  maxTolerancePct: number;
  enableAutoFix: boolean;
  timeoutMs: number;
}

@Injectable()
export class EnhancedValidateNode {
  private readonly logger = new Logger(EnhancedValidateNode.name);
  private readonly config: ValidationConfig;

  constructor(config?: Partial<ValidationConfig>) {
    this.config = {
      strictMode: false,
      maxTolerancePct: 0.1,
      enableAutoFix: true,
      timeoutMs: 10_000,
      ...config,
    };
  }

  async execute(state: GradingGraphState): Promise<GradingGraphState> {
    const startTime = Date.now();
    const nodeName = "validate";

    try {
      if (shouldAbortProcessing(state)) {
        return addError(
          state,
          "Processing aborted due to timeout or excessive errors",
          nodeName,
        );
      }

      if (isNodeCircuitBreakerOpen(state, nodeName)) {
        this.logger.warn("Circuit breaker open, using fallback validation");
        return this.executeWithFallback(state, nodeName, startTime);
      }

      if (!state.graderResult) {
        const errorState = addError(
          state,
          "No grader result to validate",
          nodeName,
        );
        return updateCircuitBreaker(errorState, nodeName, false);
      }

      const validationResult = await this.validateGradeWithTimeout(
        state.graderResult,
      );

      if (validationResult.isValid) {
        const successState = {
          ...state,
          graderResult: validationResult,
          currentStep: "evidence",
          shouldContinue: true,
        };

        return this.recordSuccessAndReturn(successState, nodeName, startTime);
      }

      const strategy = determineFallbackStrategy(state, nodeName);
      return this.handleValidationFailure(
        state,
        validationResult,
        strategy,
        nodeName,
        startTime,
      );
    } catch (error) {
      return this.handleCriticalError(state, error, nodeName, startTime);
    }
  }

  private async validateGradeWithTimeout(grade: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Validation timeout"));
      }, this.config.timeoutMs);

      try {
        const result = this.validateGrade(grade);
        clearTimeout(timeout);
        resolve(result);
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  private validateGrade(grade: any) {
    const validationErrors: string[] = [];
    let arithmeticFixed = false;
    const gradeClone = { ...grade };

    if (!grade) {
      throw new Error("No grade to validate");
    }

    try {
      const calculatedTotal = gradeClone.criteriaAwards.reduce(
        (sum: number, award: any) => sum + (award.awarded || 0),
        0,
      );
      const calculatedMax = gradeClone.criteriaAwards.reduce(
        (sum: number, award: any) => sum + (award.maxPoints || 0),
        0,
      );

      const totalTolerance = calculatedTotal * this.config.maxTolerancePct;
      const maxTolerance = calculatedMax * this.config.maxTolerancePct;

      if (
        Math.abs(calculatedTotal - gradeClone.totalAwarded) > totalTolerance
      ) {
        if (this.config.enableAutoFix) {
          gradeClone.totalAwarded = calculatedTotal;
          arithmeticFixed = true;
        } else {
          validationErrors.push(
            `Total awarded mismatch: calculated=${calculatedTotal}, provided=${gradeClone.totalAwarded}`,
          );
        }
      }

      if (Math.abs(calculatedMax - gradeClone.totalMax) > maxTolerance) {
        if (this.config.enableAutoFix) {
          gradeClone.totalMax = calculatedMax;
          arithmeticFixed = true;
        } else {
          validationErrors.push(
            `Total max mismatch: calculated=${calculatedMax}, provided=${gradeClone.totalMax}`,
          );
        }
      }

      for (const award of gradeClone.criteriaAwards) {
        if (award.awarded < 0) {
          if (this.config.enableAutoFix) {
            award.awarded = 0;
            arithmeticFixed = true;
          } else {
            validationErrors.push(
              `Negative score for criterion ${award.criterionId}`,
            );
          }
        }

        if (
          award.awarded >
          award.maxPoints + award.maxPoints * this.config.maxTolerancePct
        ) {
          if (this.config.enableAutoFix) {
            award.awarded = award.maxPoints;
            arithmeticFixed = true;
          } else {
            validationErrors.push(
              `Score exceeds max for criterion ${award.criterionId}`,
            );
          }
        }

        if (!award.justification || award.justification.trim().length === 0) {
          if (this.config.enableAutoFix) {
            award.justification = "Score assigned based on rubric criteria";
            arithmeticFixed = true;
          } else {
            validationErrors.push(
              `Missing justification for criterion ${award.criterionId}`,
            );
          }
        }

        if (award.justification && award.justification.length > 500) {
          if (this.config.enableAutoFix) {
            award.justification = award.justification.slice(0, 497) + "...";
            arithmeticFixed = true;
          } else {
            validationErrors.push(
              `Justification too long for criterion ${award.criterionId}`,
            );
          }
        }
      }

      if (gradeClone.confidence < 0 || gradeClone.confidence > 1) {
        if (this.config.enableAutoFix) {
          gradeClone.confidence = Math.max(
            0,
            Math.min(1, gradeClone.confidence),
          );
          arithmeticFixed = true;
        } else {
          validationErrors.push("Confidence must be between 0 and 1");
        }
      }

      if (
        gradeClone.overallFeedback &&
        gradeClone.overallFeedback.length > 1000
      ) {
        if (this.config.enableAutoFix) {
          gradeClone.overallFeedback =
            gradeClone.overallFeedback.slice(0, 997) + "...";
          arithmeticFixed = true;
        } else {
          validationErrors.push("Overall feedback too long");
        }
      }

      if (this.config.strictMode && validationErrors.length > 0) {
        throw new Error(
          `Strict validation failed: ${validationErrors.join(", ")}`,
        );
      }

      try {
        ValidatedGradeSchema.parse({
          ...gradeClone,
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
        ...gradeClone,
        isValid: validationErrors.length === 0,
        validationErrors,
        arithmeticFixed,
      };
    } catch (error) {
      this.logger.error("Validation processing error:", error);
      return {
        ...gradeClone,
        isValid: false,
        validationErrors: [
          `Validation processing failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ],
        arithmeticFixed,
      };
    }
  }

  private handleValidationFailure(
    state: GradingGraphState,
    validationResult: any,
    strategy: string,
    nodeName: string,
    startTime: number,
  ): GradingGraphState {
    const executionTime = Date.now() - startTime;

    switch (strategy) {
      case "retry": {
        if (state.retry_count < (state.context.maxRetries || 2)) {
          const retryState = {
            ...state,
            graderResult: validationResult,
            retry_count: state.retry_count + 1,
            currentStep: "grade",
            shouldContinue: true,
          };
          return recordNodeExecution(retryState, nodeName, executionTime);
        }
        break;
      }

      case "fallback": {
        return this.executeWithFallback(state, nodeName, startTime);
      }

      case "skip": {
        this.logger.warn("Skipping validation due to circuit breaker");
        const skipState = addError(
          state,
          "Validation skipped due to repeated failures",
          nodeName,
        );
        return recordNodeExecution(skipState, nodeName, executionTime);
      }

      case "abort": {
        const abortState = addError(
          state,
          "Validation aborted due to system constraints",
          nodeName,
        );
        return {
          ...recordNodeExecution(abortState, nodeName, executionTime),
          shouldContinue: false,
          currentStep: "error",
        };
      }
    }

    const failedState = addError(
      state,
      `Validation failed after retries: ${validationResult.validationErrors.join(
        ", ",
      )}`,
      nodeName,
    );

    return {
      ...updateCircuitBreaker(failedState, nodeName, false),
      graderResult: validationResult,
      shouldContinue: false,
      currentStep: "error",
    };
  }

  private executeWithFallback(
    state: GradingGraphState,
    nodeName: string,
    startTime: number,
  ): GradingGraphState {
    this.logger.log("Using fallback validation");

    if (!state.graderResult) {
      const errorState = addError(
        state,
        "No grader result for fallback validation",
        nodeName,
      );
      return recordNodeExecution(errorState, nodeName, Date.now() - startTime);
    }

    const fallbackResult = {
      ...state.graderResult,
      isValid: true,
      validationErrors: ["Fallback validation used due to system constraints"],
      arithmeticFixed: false,
    };

    const successState = {
      ...state,
      graderResult: fallbackResult,
      currentStep: "evidence",
      shouldContinue: true,
      fallback_used: true,
    };

    return recordNodeExecution(successState, nodeName, Date.now() - startTime);
  }

  private handleCriticalError(
    state: GradingGraphState,
    error: any,
    nodeName: string,
    startTime: number,
  ): GradingGraphState {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown validation error";
    this.logger.error(`Critical validation error: ${errorMessage}`, error);

    const errorState = addError(
      state,
      `Critical validation error: ${errorMessage}`,
      nodeName,
    );
    const updatedState = updateCircuitBreaker(errorState, nodeName, false);

    return {
      ...recordNodeExecution(updatedState, nodeName, Date.now() - startTime),
      shouldContinue: false,
      currentStep: "error",
    };
  }

  private recordSuccessAndReturn(
    state: GradingGraphState,
    nodeName: string,
    startTime: number,
  ): GradingGraphState {
    const executionTime = Date.now() - startTime;
    const successState = updateCircuitBreaker(state, nodeName, true);
    return recordNodeExecution(successState, nodeName, executionTime);
  }
}
