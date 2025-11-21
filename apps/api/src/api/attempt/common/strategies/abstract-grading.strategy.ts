import { Inject, Injectable, Optional } from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import {
  CreateQuestionResponseAttemptResponseDto,
  GeneralFeedbackDto,
} from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import {
  QuestionDto,
  RubricDto,
  ScoringDto,
} from "src/api/assignment/dto/update.questions.request.dto";
import { GradingConsistencyService } from "src/api/assignment/v2/services/grading-consistency.service";
import { IGradingJudgeService } from "src/api/llm/features/grading/interfaces/grading-judge.interface";
import { GRADING_JUDGE_SERVICE } from "src/api/llm/llm.constants";
import { RubricScore } from "src/api/llm/model/file.based.question.response.model";
import { Logger } from "winston";
import { GRADING_AUDIT_SERVICE } from "../../attempt.constants";
import { GradingAuditService } from "../../services/question-response/grading-audit.service";
import { GradingContext } from "../interfaces/grading-context.interface";
import { IGradingStrategy } from "../interfaces/grading-strategy.interface";
import { LocalizationService } from "../utils/localization.service";

export interface GradingValidationResult {
  isValid: boolean;
  issues: string[];
  corrections?: {
    points?: number;
    feedback?: string;
    rubricScores?: any[];
  };
}

export interface FeedbackTone {
  tone: "positive" | "negative" | "neutral";
  confidence: number;
}

@Injectable()
export abstract class AbstractGradingStrategy<T> implements IGradingStrategy {
  protected readonly logger?: Logger;

  constructor(
    protected readonly localizationService: LocalizationService,
    @Inject(GRADING_AUDIT_SERVICE)
    protected readonly gradingAuditService: GradingAuditService,
    @Optional()
    protected readonly consistencyService?: GradingConsistencyService,
    @Optional()
    @Inject(GRADING_JUDGE_SERVICE)
    protected readonly gradingJudgeService?: IGradingJudgeService,
    @Optional() @Inject(WINSTON_MODULE_PROVIDER) parentLogger?: Logger,
  ) {
    if (this.consistencyService) {
      this.consistencyService = undefined;
    }

    if (parentLogger) {
      this.logger = parentLogger.child({
        context: this.constructor.name,
      });
    }
  }

  /**
   * Validate the response format
   */
  abstract validateResponse(
    question: QuestionDto,
    requestDto: CreateQuestionResponseAttemptRequestDto,
  ): Promise<boolean>;

  /**
   * Extract the learner response in the appropriate format
   */
  abstract extractLearnerResponse(
    requestDto: CreateQuestionResponseAttemptRequestDto,
  ): Promise<T>;

  /**
   * Grade the response and return the result
   */
  abstract gradeResponse(
    question: QuestionDto,
    learnerResponse: T,
    context: GradingContext,
  ): Promise<CreateQuestionResponseAttemptResponseDto>;

  /**
   * Create a response DTO with feedback
   */
  protected createResponseDto(
    points: number,
    feedback: any[],
  ): CreateQuestionResponseAttemptResponseDto {
    const responseDto = new CreateQuestionResponseAttemptResponseDto();
    responseDto.totalPoints = this.sanitizePoints(points);
    responseDto.feedback = Array.isArray(feedback) ? feedback : [];
    responseDto.metadata = {};
    return responseDto;
  }

  /**
   * Create a general feedback DTO
   */
  protected createGeneralFeedback(message: string): GeneralFeedbackDto {
    const feedback = new GeneralFeedbackDto();
    feedback.feedback = message || "";
    return feedback;
  }

  /**
   * Validate grading consistency and fairness
   */
  protected async validateGradingConsistency(
    response: CreateQuestionResponseAttemptResponseDto,
    question: QuestionDto,
    context: GradingContext,
    learnerResponseText: string,
  ): Promise<GradingValidationResult> {
    const issues: string[] = [];
    const corrections: {
      points?: number;
      feedback?: string;
      rubricScores?: RubricDto[];
    } = {};

    try {
      if (
        !this.isValidNumber(response.totalPoints) ||
        response.totalPoints < 0
      ) {
        issues.push("Points cannot be negative or invalid");
        corrections.points = 0;
      }

      if (response.totalPoints > question.totalPoints) {
        issues.push(`Points exceed maximum (${question.totalPoints})`);
        corrections.points = question.totalPoints;
      }

      if (
        this.consistencyService &&
        typeof this.consistencyService.generateResponseHash === "function"
      ) {
        try {
          const responseHash = this.consistencyService.generateResponseHash(
            learnerResponseText,
            question.id,
            question.type,
          );

          const consistencyCheck =
            await this.consistencyService.checkConsistency(
              question.id,
              responseHash,
              learnerResponseText,
              question.type,
            );

          if (consistencyCheck.similar && consistencyCheck.shouldAdjust) {
            const deviationPercentage =
              consistencyCheck.deviationPercentage || 0;

            if (deviationPercentage > 15) {
              issues.push(
                `Similar response previously graded differently (${deviationPercentage.toFixed(
                  1,
                )}% deviation)`,
              );

              if (consistencyCheck.previousGrade !== undefined) {
                corrections.points = consistencyCheck.previousGrade;
                corrections.feedback = this.adjustFeedbackForConsistency(
                  response.feedback,
                  consistencyCheck.previousFeedback,
                );
              }
            }
          }
        } catch (error) {
          this.logger?.warn("Consistency check failed:", error);
        }
      }

      const scorePercentage =
        (response.totalPoints / question.totalPoints) * 100;
      const feedbackTone = this.analyzeFeedbackTone(response.feedback);

      if (
        scorePercentage >= 90 &&
        feedbackTone.tone === "negative" &&
        feedbackTone.confidence > 0.7
      ) {
        issues.push("Negative feedback tone doesn't match high score");
      } else if (
        scorePercentage < 50 &&
        feedbackTone.tone === "positive" &&
        feedbackTone.confidence > 0.7
      ) {
        issues.push("Positive feedback tone doesn't match low score");
      }

      if (response.metadata?.rubricScores) {
        const mathValidation = this.validateRubricMath(
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          response.metadata.rubricScores,
          response.totalPoints,
          question.scoring,
        );

        if (
          !mathValidation.valid &&
          mathValidation.correctedTotal !== undefined
        ) {
          issues.push("Rubric scores don't match total points");
          corrections.points = mathValidation.correctedTotal;
        }
      }
    } catch (error) {
      this.logger?.error("Error validating grading consistency:", error);
    }

    return {
      isValid: issues.length === 0,
      issues,
      corrections:
        Object.keys(corrections).length > 0 ? corrections : undefined,
    };
  }

  /**
   * Ensure rubric scores are mathematically consistent
   */
  protected validateRubricMath(
    rubricScores: RubricScore[],
    totalPoints: number,
    scoringCriteria: ScoringDto,
  ): { valid: boolean; correctedTotal?: number } {
    if (!Array.isArray(rubricScores) || rubricScores.length === 0) {
      return { valid: true };
    }

    try {
      let calculatedTotal = 0;
      for (const score of rubricScores) {
        calculatedTotal += this.extractPointsFromRubricScore(score);
      }
      if (Math.abs(calculatedTotal - totalPoints) > 0.01) {
        return {
          valid: false,
          correctedTotal: calculatedTotal,
        };
      }
      if (
        this.consistencyService &&
        scoringCriteria &&
        typeof this.consistencyService.validateRubricScores === "function"
      ) {
        const validation = this.consistencyService.validateRubricScores(
          rubricScores,
          scoringCriteria,
        );

        if (!validation.valid) {
          const corrections: RubricScore[] = validation.corrections ?? [];
          let correctedTotal = 0;

          for (const score of corrections) {
            correctedTotal += this.extractPointsFromRubricScore(score);
          }

          return {
            valid: false,
            correctedTotal,
          };
        }
      }

      return { valid: true };
    } catch (error) {
      this.logger?.error("Error validating rubric math:", error);
      return { valid: true };
    }
  }

  /**
   * Analyze feedback tone
   */
  private analyzeFeedbackTone(feedback: any): FeedbackTone {
    try {
      const feedbackText = this.extractTextFromFeedback(feedback).toLowerCase();

      const positiveWords = [
        "excellent",
        "great",
        "good",
        "well done",
        "impressive",
        "strong",
        "effective",
        "successful",
        "outstanding",
        "perfect",
        "exceptional",
        "superb",
        "brilliant",
        "fantastic",
        "wonderful",
      ];

      const negativeWords = [
        "poor",
        "weak",
        "insufficient",
        "lacking",
        "needs improvement",
        "failed",
        "incorrect",
        "inadequate",
        "wrong",
        "missing",
        "incomplete",
        "unsatisfactory",
        "below",
        "deficient",
        "problematic",
      ];

      let positiveCount = 0;
      let negativeCount = 0;

      for (const word of positiveWords) {
        if (feedbackText.includes(word)) positiveCount++;
      }

      for (const word of negativeWords) {
        if (feedbackText.includes(word)) negativeCount++;
      }

      const totalWords = positiveCount + negativeCount;
      if (totalWords === 0) {
        return { tone: "neutral", confidence: 1 };
      }

      const confidence = Math.min(totalWords / 5, 1);

      if (positiveCount > negativeCount * 2) {
        return { tone: "positive", confidence };
      } else if (negativeCount > positiveCount * 2) {
        return { tone: "negative", confidence };
      } else {
        return { tone: "neutral", confidence };
      }
    } catch {
      return { tone: "neutral", confidence: 0.5 };
    }
  }

  /**
   * Extract text from various feedback formats
   */
  private extractTextFromFeedback(feedback: any): string {
    try {
      if (typeof feedback === "string") {
        return feedback;
      }

      if (Array.isArray(feedback)) {
        return feedback
          .map((f) => {
            if (typeof f === "string") return f;
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return
            if (f?.feedback) return f.feedback;
            return JSON.stringify(f);
          })
          .join(" ");
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (feedback?.feedback) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
        return feedback.feedback;
      }

      return JSON.stringify(feedback);
    } catch {
      return "";
    }
  }

  /**
   * Adjust feedback to maintain consistency
   */
  private adjustFeedbackForConsistency(
    currentFeedback: any,
    previousFeedback?: string,
  ): string {
    try {
      const currentText = this.extractTextFromFeedback(currentFeedback);

      if (!previousFeedback) return currentText;

      const adjustedFeedback = `${currentText}\n\n**Note**: This response is similar to previous submissions and has been graded consistently.`;

      return adjustedFeedback;
    } catch {
      return this.extractTextFromFeedback(currentFeedback);
    }
  }

  /**
   * Record grading for audit and consistency (non-blocking)
   * This method will log all activities and continue even if recording fails
   */
  protected async recordGrading(
    question: QuestionDto,
    requestDto: CreateQuestionResponseAttemptRequestDto,
    responseDto: CreateQuestionResponseAttemptResponseDto,
    context: GradingContext,
    gradingStrategy: string,
  ): Promise<void> {
    const startTime = Date.now();

    this.logger?.info("Starting grading record process", {
      questionId: question.id,
      questionType: question.type,
      assignmentId: context.assignmentId,
      gradingStrategy,
      responseType: question.responseType,
      totalPoints: responseDto.totalPoints,
      maxPoints: question.totalPoints,
    });

    try {
      if (!this.gradingAuditService) {
        this.logger?.error("GradingAuditService is not available", {
          questionId: question.id,
          gradingStrategy,
          hasService: !!this.gradingAuditService,
        });
        return;
      }

      if (typeof this.gradingAuditService.recordGrading !== "function") {
        this.logger?.error(
          "GradingAuditService.recordGrading is not a function - wrong service type injected",
          {
            questionId: question.id,
            gradingStrategy,
            serviceType: typeof this.gradingAuditService,
            serviceConstructor: this.gradingAuditService.constructor.name,
            availableMethods: Object.getOwnPropertyNames(
              Object.getPrototypeOf(this.gradingAuditService),
            ),
            expectedService: "GradingAuditService",
            actualService: this.gradingAuditService.constructor.name,
          },
        );

        this.logger?.warn(
          "Skipping grading audit due to dependency injection issue",
          {
            questionId: question.id,
            gradingStrategy,
          },
        );
        return;
      }

      const auditPromise = this.gradingAuditService.recordGrading({
        questionId: question.id,
        assignmentId: context.assignmentId,
        requestDto,
        responseDto,
        gradingStrategy,
        metadata: {
          language: context.language,
          userRole: context.userRole,
          timestamp: new Date().toISOString(),
          version: "2.0",
          processingTime: Date.now() - startTime,
        },
      });

      const consistencyPromise = this.recordConsistencyData(
        question,
        requestDto,
        responseDto,
        context,
      );

      const results = await Promise.allSettled([
        auditPromise,
        consistencyPromise,
      ]);

      for (const [index, result] of results.entries()) {
        const operation = index === 0 ? "audit" : "consistency";
        if (result.status === "fulfilled") {
          this.logger?.debug(`Successfully recorded ${operation} data`, {
            questionId: question.id,
            operation,
          });
        } else {
          this.logger?.warn(`Failed to record ${operation} data - continuing`, {
            questionId: question.id,
            operation,
            error:
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
          });
        }
      }

      const duration = Date.now() - startTime;
      this.logger?.info("Completed grading record process", {
        questionId: question.id,
        gradingStrategy,
        duration,
        auditSuccess: results[0].status === "fulfilled",
        consistencySuccess: results[1].status === "fulfilled",
      });
    } catch (error) {
      this.logger?.error("Unexpected error in recordGrading", {
        questionId: question.id,
        gradingStrategy,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  /**
   * Record consistency data separately for better error handling
   */
  private async recordConsistencyData(
    question: QuestionDto,
    requestDto: CreateQuestionResponseAttemptRequestDto,
    responseDto: CreateQuestionResponseAttemptResponseDto,
    _context: GradingContext,
  ): Promise<void> {
    if (!this.consistencyService) {
      this.logger?.debug(
        "Consistency service not available - skipping consistency recording",
      );
      return;
    }

    if (typeof this.consistencyService.generateResponseHash !== "function") {
      this.logger?.error(
        "GradingConsistencyService.generateResponseHash is not a function - wrong service type injected",
        {
          questionId: question.id,
          serviceType: typeof this.consistencyService,
          serviceConstructor: this.consistencyService.constructor.name,
          availableMethods: Object.getOwnPropertyNames(
            Object.getPrototypeOf(this.consistencyService),
          ),
          expectedService: "GradingConsistencyService",
          actualService: this.consistencyService.constructor.name,
        },
      );
      return;
    }

    try {
      const responseText = this.extractResponseText(requestDto);
      const responseHash = this.consistencyService.generateResponseHash(
        responseText,
        question.id,
        question.type,
      );

      await this.consistencyService.recordGrading(
        question.id,
        responseHash,
        responseDto.totalPoints,
        question.totalPoints,
        JSON.stringify(responseDto.feedback),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        responseDto.metadata?.rubricScores,
      );
    } catch (error) {
      this.logger?.error("Error in consistency recording", {
        questionId: question.id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  /**
   * Extract response text for consistency checking
   */
  private extractResponseText(
    requestDto: CreateQuestionResponseAttemptRequestDto,
  ): string {
    if (requestDto.learnerTextResponse) return requestDto.learnerTextResponse;
    if (requestDto.learnerChoices) return requestDto.learnerChoices.join(",");
    if (requestDto.learnerAnswerChoice !== undefined)
      return String(requestDto.learnerAnswerChoice);
    if (requestDto.learnerUrlResponse) return requestDto.learnerUrlResponse;
    if (requestDto.learnerFileResponse)
      return requestDto.learnerFileResponse
        .map((f) => f.filename || "file")
        .join(",");
    if (requestDto.learnerPresentationResponse)
      return JSON.stringify(requestDto.learnerPresentationResponse);
    return "";
  }

  /**
   * Generate feedback with proper score alignment
   */
  protected generateAlignedFeedback(
    points: number,
    maxPoints: number,
    analysis: string,
    evaluation: string,
    explanation: string,
    guidance: string,
    rubricDetails?: string,
  ): string {
    const percentage =
      maxPoints > 0 ? Math.round((points / maxPoints) * 100) : 0;
    const gradeContext = this.getGradeContext(percentage);

    return `
**Overall Performance**: ${gradeContext}

**Analysis:**
${analysis}

**Evaluation:**
${evaluation}${rubricDetails || ""}

**Score Explanation:**
You earned ${points} out of ${maxPoints} points (${percentage}%).
${explanation}

**Guidance for Improvement:**
${guidance}

---
*This grade has been validated for consistency and fairness.*
`.trim();
  }

  /**
   * Get grade context message based on percentage
   */
  private getGradeContext(percentage: number): string {
    if (percentage >= 95) return "Outstanding work!";
    if (percentage >= 90) return "Excellent performance!";
    if (percentage >= 85) return "Very good work!";
    if (percentage >= 80) return "Good performance.";
    if (percentage >= 75) return "Above average work.";
    if (percentage >= 70) return "Satisfactory performance.";
    if (percentage >= 65) return "Adequate work with room for improvement.";
    if (percentage >= 60) return "Below average performance.";
    if (percentage >= 50) return "Needs significant improvement.";
    return "Substantial improvement required.";
  }

  /**
   * Sanitize points to ensure valid number
   */
  private sanitizePoints(points: any): number {
    if (
      typeof points === "number" &&
      !Number.isNaN(points) &&
      Number.isFinite(points)
    ) {
      return Math.max(0, points);
    }
    return 0;
  }

  /**
   * Check if value is a valid number
   */
  private isValidNumber(value: any): boolean {
    return (
      typeof value === "number" &&
      !Number.isNaN(value) &&
      Number.isFinite(value)
    );
  }

  /**
   * Extract points from rubric score object safely
   */
  private extractPointsFromRubricScore(score: RubricScore): number {
    if (!score || typeof score !== "object") return 0;

    const points =
      typeof score.pointsAwarded === "number" ? score.pointsAwarded : 0;
    return this.sanitizePoints(points);
  }
}
