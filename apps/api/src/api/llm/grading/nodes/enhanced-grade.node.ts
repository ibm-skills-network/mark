/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-misused-promises */
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
import { GradeSchema } from "../schemas/zod-schemas";
import {
  GradeData,
  GradingContextData,
  LLMGradingRequest,
  RubricCriterion,
} from "../types/grading.types";

interface LLMGradingService {
  gradeWithRubric(context: LLMGradingRequest): Promise<GradeData>;
}

interface GradingConfig {
  defaultTimeout: number;
  maxRetries: number;
  enableFallbackGrading: boolean;
  fallbackConfidence: number;
  enablePromptOptimization: boolean;
}

@Injectable()
export class EnhancedGradeNode {
  private readonly logger = new Logger(EnhancedGradeNode.name);
  private readonly config: GradingConfig;

  constructor(
    private llmGradingService: LLMGradingService,
    config?: Partial<GradingConfig>,
  ) {
    this.config = {
      defaultTimeout: 60_000,
      maxRetries: 3,
      enableFallbackGrading: true,
      fallbackConfidence: 0.5,
      enablePromptOptimization: true,
      ...config,
    };
  }

  async execute(state: GradingGraphState): Promise<GradingGraphState> {
    const startTime = Date.now();
    const nodeName = "grade";

    try {
      if (shouldAbortProcessing(state)) {
        return addError(
          state,
          "Processing aborted due to timeout or excessive errors",
          nodeName,
        );
      }

      if (isNodeCircuitBreakerOpen(state, nodeName)) {
        this.logger.warn("Circuit breaker open, using fallback grading");
        return this.executeWithFallback(state, nodeName, startTime);
      }

      const gradingResult = await this.performGradingWithTimeout(state);

      if (gradingResult) {
        const successState = {
          ...state,
          graderResult: {
            ...gradingResult,
            isValid: true,
            validationErrors: [],
            arithmeticFixed: false,
          },
          currentStep: "validate",
          shouldContinue: true,
        };

        return this.recordSuccessAndReturn(successState, nodeName, startTime);
      }

      return this.handleGradingFailure(
        state,
        new Error("Grading returned null result"),
        nodeName,
        startTime,
      );
    } catch (error) {
      return this.handleGradingFailure(state, error, nodeName, startTime);
    }
  }

  private async performGradingWithTimeout(
    state: GradingGraphState,
  ): Promise<GradeData | null> {
    const timeout = state.context.timeout || this.config.defaultTimeout;
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Grading timeout after ${timeout}ms`));
      }, timeout);

      this.llmGradingService
        .gradeWithRubric({
          ...this.optimizeGradingContext(state.context),
          timeout: timeout - 5000,
        })
        .then((result) => {
          clearTimeout(timeoutId);
          const parsed = GradeSchema.parse(result) as GradeData;
          resolve(parsed);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  private optimizeGradingContext(
    context: GradingContextData,
  ): LLMGradingRequest {
    if (!this.config.enablePromptOptimization) {
      return {
        questionId: context.questionId,
        learnerAnswer: context.learnerAnswer,
        rubric: context.rubric,
        questionType: context.questionType,
        responseType: context.responseType,
        timeout: context.timeout,
      };
    }

    const optimizedRubric: RubricCriterion[] = context.rubric.map(
      (criterion) => ({
        id: criterion.id,
        description: this.truncateDescription(criterion.description),
        maxPoints: criterion.maxPoints,
        keywords: criterion.keywords?.slice(0, 5),
      }),
    );

    const optimizedAnswer = this.truncateAnswer(
      context.learnerAnswer,
      context.questionType,
    );

    return {
      ...context,
      learnerAnswer: optimizedAnswer,
      rubric: optimizedRubric,
    };
  }

  private truncateDescription(description: string): string {
    if (description.length <= 200) return description;

    const sentences = description.split(/[!.?]+/);
    let truncated = sentences[0];

    for (
      let index = 1;
      index < sentences.length && truncated.length < 200;
      index++
    ) {
      truncated += ". " + sentences[index];
    }

    return truncated.length > 200 ? truncated.slice(0, 197) + "..." : truncated;
  }

  private truncateAnswer(answer: string, questionType: string): string {
    const maxLength = this.getMaxAnswerLength(questionType);

    if (answer.length <= maxLength) return answer;

    const words = answer.split(/\s+/);
    let truncated = "";

    for (const word of words) {
      if ((truncated + " " + word).length > maxLength - 20) break;
      truncated += (truncated ? " " : "") + word;
    }

    return truncated + "... [truncated]";
  }

  private getMaxAnswerLength(questionType: string): number {
    switch (questionType) {
      case "TRUE_FALSE":
      case "SINGLE_CORRECT":
      case "MULTIPLE_CORRECT": {
        return 500;
      }
      case "TEXT": {
        return 5000;
      }
      case "UPLOAD":
      case "URL": {
        return 10_000;
      }
      default: {
        return 3000;
      }
    }
  }

  private handleGradingFailure(
    state: GradingGraphState,
    error: any,
    nodeName: string,
    startTime: number,
  ): GradingGraphState {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown grading error";
    this.logger.error(`Grading failed: ${errorMessage}`, error);

    const strategy = determineFallbackStrategy(state, nodeName);
    const executionTime = Date.now() - startTime;

    switch (strategy) {
      case "retry": {
        if (state.retry_count < this.config.maxRetries) {
          const retryState = {
            ...addError(
              state,
              `Grading attempt ${
                state.retry_count + 1
              } failed: ${errorMessage}`,
              nodeName,
            ),
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
        const skipState = addError(
          state,
          "Grading skipped due to circuit breaker",
          nodeName,
        );
        return {
          ...recordNodeExecution(skipState, nodeName, executionTime),
          shouldContinue: false,
          currentStep: "error",
        };
      }

      case "abort": {
        const abortState = addError(
          state,
          "Grading aborted due to system constraints",
          nodeName,
        );
        return {
          ...recordNodeExecution(abortState, nodeName, executionTime),
          shouldContinue: false,
          currentStep: "error",
        };
      }
    }

    const errorState = addError(
      state,
      `Grading failed: ${errorMessage}`,
      nodeName,
    );
    return {
      ...updateCircuitBreaker(
        recordNodeExecution(errorState, nodeName, executionTime),
        nodeName,
        false,
      ),
      shouldContinue: false,
      currentStep: "error",
    };
  }

  private executeWithFallback(
    state: GradingGraphState,
    nodeName: string,
    startTime: number,
  ): GradingGraphState {
    if (!this.config.enableFallbackGrading) {
      const errorState = addError(state, "Fallback grading disabled", nodeName);
      return recordNodeExecution(errorState, nodeName, Date.now() - startTime);
    }

    this.logger.log("Using fallback grading");

    try {
      const fallbackGrade = this.generateFallbackGrade(state.context);

      const successState = {
        ...state,
        graderResult: {
          ...fallbackGrade,
          isValid: true,
          validationErrors: [
            "Generated using fallback grading due to LLM failure",
          ],
          arithmeticFixed: false,
        },
        currentStep: "validate",
        shouldContinue: true,
        fallback_used: true,
      };

      return recordNodeExecution(
        successState,
        nodeName,
        Date.now() - startTime,
      );
    } catch (fallbackError) {
      const errorState = addError(
        state,
        `Fallback grading failed: ${
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError)
        }`,
        nodeName,
      );
      return recordNodeExecution(errorState, nodeName, Date.now() - startTime);
    }
  }

  private generateFallbackGrade(context: GradingContextData): GradeData {
    const totalMax = context.rubric.reduce(
      (sum, criterion) => sum + criterion.maxPoints,
      0,
    );

    const criteriaAwards = context.rubric.map((criterion) => {
      const baseScore = criterion.maxPoints * 0.6;
      const randomVariation =
        (Math.random() - 0.5) * (criterion.maxPoints * 0.2);
      const awarded = Math.max(
        0,
        Math.min(criterion.maxPoints, baseScore + randomVariation),
      );

      return {
        criterionId: criterion.id,
        awarded: Math.round(awarded * 10) / 10,
        maxPoints: criterion.maxPoints,
        justification:
          "Score assigned using fallback evaluation due to system constraints.",
        evidence: this.extractSimpleEvidence(
          context.learnerAnswer,
          criterion.keywords,
        ),
      };
    });

    const totalAwarded = criteriaAwards.reduce(
      (sum, award) => sum + award.awarded,
      0,
    );

    return {
      criteriaAwards,
      totalAwarded: Math.round(totalAwarded * 10) / 10,
      totalMax,
      overallFeedback:
        "This grade was assigned using automated fallback evaluation. Manual review recommended.",
      confidence: this.config.fallbackConfidence,
    };
  }

  private extractSimpleEvidence(
    answer: string,
    keywords?: string[],
  ): string | undefined {
    if (!keywords || keywords.length === 0) return undefined;

    const answerLower = answer.toLowerCase();
    const matchedKeywords = keywords.filter((keyword) =>
      answerLower.includes(keyword.toLowerCase()),
    );

    if (matchedKeywords.length === 0) return undefined;

    const sentences = answer.split(/[!.?]+/);
    for (const sentence of sentences) {
      for (const keyword of matchedKeywords) {
        if (sentence.toLowerCase().includes(keyword.toLowerCase())) {
          return sentence.trim().slice(0, 100);
        }
      }
    }

    return undefined;
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
