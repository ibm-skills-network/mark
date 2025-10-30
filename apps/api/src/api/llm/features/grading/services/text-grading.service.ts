/* eslint-disable unicorn/no-null */
import { PromptTemplate } from "@langchain/core/prompts";
import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { AIUsageType } from "@prisma/client";
import { StructuredOutputParser } from "langchain/output_parsers";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import {
  CriteriaDto,
  RubricDto,
  ScoringDto,
} from "src/api/assignment/dto/update.questions.request.dto";
import { RubricScore } from "src/api/llm/model/file.based.question.response.model";
import { TextBasedQuestionEvaluateModel } from "src/api/llm/model/text.based.question.evaluate.model";
import {
  GradingMetadata,
  TextBasedQuestionResponseModel,
} from "src/api/llm/model/text.based.question.response.model";
import { Logger } from "winston";
import { z } from "zod";
import { IModerationService } from "../../../core/interfaces/moderation.interface";
import { IPromptProcessor } from "../../../core/interfaces/prompt-processor.interface";
import {
  GRADING_JUDGE_SERVICE,
  MODERATION_SERVICE,
  PROMPT_PROCESSOR,
  RESPONSE_TYPE_SPECIFIC_INSTRUCTIONS,
} from "../../../llm.constants";
import { IGradingJudgeService } from "../interfaces/grading-judge.interface";
import { ITextGradingService } from "../interfaces/text-grading.interface";

export interface GradingValidation {
  isValid: boolean;
  issues: string[];
  suggestedCorrections?: {
    points?: number;
    feedback?: string;
    rubricScores?: RubricScore[];
  };
}

const GradingAttemptSchema = z.object({
  points: z
    .number()
    .min(0)
    .describe("Total points awarded (sum of all rubric scores)"),
  feedback: z
    .string()
    .describe("Comprehensive feedback following the AEEG approach"),
  analysis: z
    .string()
    .describe(
      "Detailed analysis of what is observed in the learner's response",
    ),
  evaluation: z
    .string()
    .describe(
      "Evaluation of how well the response meets each assessment aspect",
    ),
  explanation: z
    .string()
    .describe("Clear reasons for the grade based on specific observations"),
  guidance: z.string().describe("Concrete suggestions for improvement"),
  rubricScores: z
    .array(
      z.object({
        rubricQuestion: z.string().describe("The rubric question"),
        pointsAwarded: z
          .number()
          .min(0)
          .describe("Points awarded for this rubric"),
        maxPoints: z
          .number()
          .describe("Maximum points available for this rubric"),
        criterionSelected: z
          .string()
          .describe("The specific criterion level selected"),
        justification: z
          .string()
          .describe("Detailed justification for the score"),
      }),
    )
    .describe("Individual scores for each rubric criterion")
    .optional(),
  gradingRationale: z
    .string()
    .describe("Internal rationale for ensuring consistent grading"),
});

export type GradingAttempt = z.infer<typeof GradingAttemptSchema>;

let singletonParser: StructuredOutputParser<
  typeof GradingAttemptSchema
> | null = null;

@Injectable()
export class TextGradingService implements ITextGradingService {
  private readonly logger: Logger;
  private readonly maxRetries = 3;
  private readonly retryDelay = 1000;

  constructor(
    @Inject(PROMPT_PROCESSOR)
    private readonly promptProcessor: IPromptProcessor,
    @Inject(MODERATION_SERVICE)
    private readonly moderationService: IModerationService,
    @Inject(GRADING_JUDGE_SERVICE)
    private readonly gradingJudgeService: IGradingJudgeService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: TextGradingService.name });
  }

  /**
   * Grade a text-based question response with judge validation
   */
  async gradeTextBasedQuestion(
    textBasedQuestionEvaluateModel: TextBasedQuestionEvaluateModel,
    assignmentId: number,
    language?: string,
  ): Promise<TextBasedQuestionResponseModel> {
    const startTime = Date.now();

    try {
      const { question, learnerResponse, totalPoints, scoringCriteria } =
        textBasedQuestionEvaluateModel;

      const sanitizedLearnerResponse = this.sanitizeInput(learnerResponse);

      const isValidResponse = await this.moderationService.validateContent(
        sanitizedLearnerResponse,
      );
      if (!isValidResponse) {
        throw new HttpException(
          "Learner response validation failed",
          HttpStatus.BAD_REQUEST,
        );
      }

      const maxPossiblePoints = this.calculateMaxPossiblePoints(
        scoringCriteria as ScoringDto,
        totalPoints,
      );

      const contentHash = this.generateContentHash(learnerResponse, question);

      let gradingAttempt: GradingAttempt | null = null;
      let judgeApproved = false;
      let attemptCount = 0;
      let previousJudgeFeedback: string | null = null;

      while (!judgeApproved && attemptCount < this.maxRetries) {
        attemptCount++;
        this.logger.info(
          `Grading attempt ${attemptCount}/${this.maxRetries} for assignment ${assignmentId}`,
        );

        try {
          gradingAttempt = await this.generateGrading(
            textBasedQuestionEvaluateModel,
            maxPossiblePoints,
            contentHash,
            assignmentId,
            language,
            previousJudgeFeedback,
          );

          const judgeResult = await this.validateWithJudge(
            question,
            sanitizedLearnerResponse,
            scoringCriteria as ScoringDto,
            gradingAttempt,
            maxPossiblePoints,
            assignmentId,
          );

          if (judgeResult.approved) {
            judgeApproved = true;
            this.logger.info(
              `Judge approved grading on attempt ${attemptCount}`,
            );
          } else {
            previousJudgeFeedback = this.formatJudgeFeedbackForTA(
              judgeResult,
              attemptCount,
            );
            this.logger.warn(
              `Judge rejected grading attempt ${attemptCount}: ${judgeResult.feedback}`,
            );

            if (judgeResult.corrections && gradingAttempt) {
              const originalPoints = gradingAttempt.points;
              gradingAttempt = this.applyJudgeCorrections(
                gradingAttempt,
                judgeResult.corrections,
              );

              if (
                this.areCorrectionsMinor(
                  judgeResult.corrections,
                  originalPoints,
                  maxPossiblePoints,
                )
              ) {
                judgeApproved = true;
                this.logger.info(
                  "Minor corrections applied, approving grading",
                );
              }
            }

            if (!judgeApproved && attemptCount < this.maxRetries) {
              const backoffDelay =
                this.retryDelay * Math.pow(2, attemptCount - 1);
              await this.delay(Math.min(backoffDelay, 5000));
            }
          }
        } catch (error) {
          this.logger.error(
            `Error in grading attempt ${attemptCount}: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          );

          if (attemptCount === this.maxRetries && gradingAttempt) {
            judgeApproved = true;
            this.logger.warn(
              "Using grading despite judge failure on final attempt",
            );
          }
        }
      }

      if (!gradingAttempt) {
        throw new HttpException(
          "Failed to generate grading after all attempts",
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      const normalizedAttempt = this.normalizeGradingAttempt(
        gradingAttempt,
        maxPossiblePoints,
      );

      const finalFeedback = this.generateAlignedFeedback(
        normalizedAttempt,
        maxPossiblePoints,
      );

      const endTime = Date.now();
      this.logger.info(
        `Graded text question - Points: ${gradingAttempt.points}/${maxPossiblePoints}, ` +
          `Content Hash: ${contentHash}, Judge Approved: ${judgeApproved.toString()}, ` +
          `Time: ${endTime - startTime}ms, Attempts: ${attemptCount}`,
      );

      const metadata: GradingMetadata = {
        judgeApproved,
        attempts: attemptCount,
        gradingTimeMs: endTime - startTime,
        contentHash,
      };

      return new TextBasedQuestionResponseModel(
        normalizedAttempt.points,
        finalFeedback,
        normalizedAttempt.analysis,
        normalizedAttempt.evaluation,
        normalizedAttempt.explanation,
        normalizedAttempt.guidance,
        this.ensureRequiredRubricFields(normalizedAttempt.rubricScores),
        normalizedAttempt.gradingRationale,
        metadata,
      );
    } catch (error) {
      this.logger.error(
        `Failed to grade text question: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      throw error;
    }
  }

  /**
   * Normalize a grading attempt by clamping rubric scores and total points to valid ranges.
   */
  private normalizeGradingAttempt(
    attempt: GradingAttempt,
    maxPossiblePoints: number,
  ): GradingAttempt {
    const cloned: GradingAttempt = { ...attempt } as GradingAttempt;

    let totalFromRubrics: number | undefined;
    if (Array.isArray(cloned.rubricScores) && cloned.rubricScores.length > 0) {
      type StrictRubricScore = {
        rubricQuestion: string;
        pointsAwarded: number;
        maxPoints: number;
        criterionSelected: string;
        justification: string;
      };

      const normalizedScores: StrictRubricScore[] = cloned.rubricScores.map(
        (
          r: {
            rubricQuestion?: string;
            pointsAwarded?: number;
            maxPoints?: number;
            criterionSelected?: string;
            justification?: string;
          },
          index: number,
        ): StrictRubricScore => {
          const max = Math.max(0, Number(r?.maxPoints ?? 0));
          const awardedRaw = Number(r?.pointsAwarded ?? 0);
          const awarded = Math.min(Math.max(0, awardedRaw), max);
          if (awarded !== awardedRaw) {
            this.logger.warn(
              `Clamped rubric score at index ${index} from ${awardedRaw} to ${awarded} (max ${max})`,
            );
          }
          return {
            rubricQuestion: String(r?.rubricQuestion ?? ""),
            pointsAwarded: awarded,
            maxPoints: max,
            criterionSelected: String(r?.criterionSelected ?? ""),
            justification: String(r?.justification ?? ""),
          };
        },
      );

      cloned.rubricScores =
        normalizedScores as unknown as typeof cloned.rubricScores;
      totalFromRubrics = cloned.rubricScores.reduce(
        (sum, r) => sum + (r.pointsAwarded || 0),
        0,
      );
    }

    const rawPoints = Number(cloned.points ?? 0);
    const normalizedPoints =
      totalFromRubrics === undefined ? rawPoints : totalFromRubrics;
    const cappedPoints = Math.min(
      Math.max(0, normalizedPoints),
      maxPossiblePoints,
    );
    if (cappedPoints !== rawPoints) {
      this.logger.warn(
        `Normalized total points from ${rawPoints} to ${cappedPoints} (max ${maxPossiblePoints})`,
      );
    }
    cloned.points = cappedPoints;

    return cloned;
  }

  /**
   * Generate a grading attempt
   */
  private async generateGrading(
    textBasedQuestionEvaluateModel: TextBasedQuestionEvaluateModel,
    maxPossiblePoints: number,
    contentHash: string,
    assignmentId: number,
    language?: string,
    previousJudgeFeedback?: string | null,
  ): Promise<GradingAttempt> {
    const {
      question,
      learnerResponse,
      scoringCriteriaType,
      scoringCriteria,
      previousQuestionsAnswersContext,
      assignmentInstrctions,
      responseType,
    } = textBasedQuestionEvaluateModel;

    const parser = this.getOrCreateParser();
    const formatInstructions = parser.getFormatInstructions();

    const responseSpecificInstruction =
      RESPONSE_TYPE_SPECIFIC_INSTRUCTIONS[
        responseType as keyof typeof RESPONSE_TYPE_SPECIFIC_INSTRUCTIONS
      ] ?? "";

    const template = this.loadEnhancedTextGradingTemplate();

    this.logger.info("Rubric data being passed to LLM", {
      assignmentId,
      scoringCriteriaType,
      hasRubrics: !!(scoringCriteria as ScoringDto)?.rubrics,
      rubricCount: (scoringCriteria as ScoringDto)?.rubrics?.length || 0,
      rubrics:
        (scoringCriteria as ScoringDto)?.rubrics?.map((r, index) => ({
          index: index,
          question: r.rubricQuestion,
          criteriaCount: r.criteria?.length || 0,
          criteria:
            r.criteria?.map((c) => ({
              description: c.description,
              points: c.points,
            })) || [],
        })) || [],
    });

    const prompt = new PromptTemplate({
      template,
      inputVariables: [],
      partialVariables: {
        question: () => question,
        assignment_instructions: () => assignmentInstrctions ?? "",
        responseSpecificInstruction: () => responseSpecificInstruction,
        previous_questions_and_answers: () =>
          JSON.stringify(previousQuestionsAnswersContext ?? []),
        learner_response: () => learnerResponse,
        total_points: () => maxPossiblePoints.toString(),
        scoring_type: () => scoringCriteriaType,
        scoring_criteria: () => JSON.stringify(scoringCriteria),
        format_instructions: () => formatInstructions,
        grading_type: () => responseType,
        language: () => language ?? "en",
        content_hash: () => contentHash,
        judge_feedback: () => previousJudgeFeedback || "No previous feedback",
      },
    });

    const response = await this.promptProcessor.processPromptForFeature(
      prompt,
      assignmentId,
      AIUsageType.ASSIGNMENT_GRADING,
      "text_grading",
      "gpt-4o-mini",
    );

    const parsedResponse = await parser.parse(response);

    this.logger.info(
      `LLM grading result - Points: ${parsedResponse.points}/${maxPossiblePoints}, ` +
        `Rubric scores: ${parsedResponse.rubricScores?.length || 0} items`,
    );

    return parsedResponse;
  }

  /**
   * Validate grading with judge service
   */
  private async validateWithJudge(
    question: string,
    learnerResponse: string,
    scoringCriteria: ScoringDto,
    gradingAttempt: GradingAttempt,
    maxPossiblePoints: number,
    assignmentId: number,
  ) {
    try {
      return await this.gradingJudgeService.validateGrading({
        question,
        learnerResponse,
        scoringCriteria,
        proposedGrading: {
          points: gradingAttempt.points,
          maxPoints: maxPossiblePoints,
          feedback: this.generateAlignedFeedback(
            gradingAttempt,
            maxPossiblePoints,
          ),
          rubricScores: gradingAttempt.rubricScores as RubricDto[],
          analysis: gradingAttempt.analysis,
          evaluation: gradingAttempt.evaluation,
          explanation: gradingAttempt.explanation,
          guidance: gradingAttempt.guidance,
        },
        assignmentId,
      });
    } catch (error) {
      this.logger.error(
        `Judge validation failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      return {
        approved: true,
        feedback: "Judge validation failed, approving by default",
      };
    }
  }

  /**
   * Apply corrections from judge
   */
  private applyJudgeCorrections(
    gradingAttempt: GradingAttempt,
    corrections: {
      points?: number;
      feedback?: string;
      rubricScores?: RubricScore[];
    },
  ): GradingAttempt {
    const corrected = { ...gradingAttempt };

    if (corrections.points !== undefined) {
      corrected.points = corrections.points;
    }

    if (corrections.feedback) {
      corrected.explanation = `${corrected.explanation}\n\n**Judge Adjustment**: ${corrections.feedback}`;
    }

    if (corrections.rubricScores && Array.isArray(corrections.rubricScores)) {
      corrected.rubricScores = corrections.rubricScores;
      corrected.points = corrections.rubricScores.reduce(
        (sum: number, score: RubricScore) => sum + (score.pointsAwarded || 0),
        0,
      );
    }

    return corrected;
  }

  /**
   * Check if corrections are minor enough to auto-approve
   */
  private areCorrectionsMinor(
    corrections: {
      points?: number;
      feedback?: string;
      rubricScores?: RubricScore[];
    },
    originalPoints?: number,
    maxPoints?: number,
  ): boolean {
    if (corrections.rubricScores) return false;
    if (corrections.feedback) return false;

    if (
      corrections.points !== undefined &&
      originalPoints !== undefined &&
      maxPoints !== undefined
    ) {
      const pointDifference = Math.abs(corrections.points - originalPoints);
      const percentageChange =
        maxPoints > 0 ? (pointDifference / maxPoints) * 100 : 0;

      return percentageChange <= 5;
    }
    return false;
  }

  /**
   * Sanitize user input to prevent prompt injection and other attacks
   */
  private sanitizeInput(input: string): string {
    if (!input || typeof input !== "string") {
      return "";
    }

    return input
      .replaceAll(/[^\t\n\r\u0020-\u007E\u00A0-\uFFFF]/gu, "")
      .replaceAll(/\n{3,}/g, "\n\n")
      .replaceAll(/(?:^|\n)\s*(?:system|user|assistant|human):/gi, "")
      .replaceAll(
        /(?:^|\n)\s*(?:ignore|disregard|forget).*?(?:instruction|prompt|rule)/gi,
        "",
      )
      .slice(0, 10_000)
      .trim();
  }

  /**
   * Compare numbers with zero tolerance - must be exactly equal
   */
  private areNumbersEqual(a: number, b: number, tolerance = 0): boolean {
    return Math.abs(a - b) <= tolerance;
  }

  /**
   * Get or create parser (singleton for performance)
   */
  private getOrCreateParser(): StructuredOutputParser<
    typeof GradingAttemptSchema
  > {
    if (!singletonParser) {
      singletonParser = StructuredOutputParser.fromZodSchema(
        z.object({
          points: z
            .number()
            .min(0)
            .describe("Total points awarded (sum of all rubric scores)"),
          feedback: z
            .string()
            .describe("Comprehensive feedback following the AEEG approach"),
          analysis: z
            .string()
            .describe(
              "Detailed analysis of what is observed in the learner's response",
            ),
          evaluation: z
            .string()
            .describe(
              "Evaluation of how well the response meets each assessment aspect",
            ),
          explanation: z
            .string()
            .describe(
              "Clear reasons for the grade based on specific observations",
            ),
          guidance: z.string().describe("Concrete suggestions for improvement"),
          rubricScores: z
            .array(
              z.object({
                rubricQuestion: z.string().describe("The rubric question"),
                pointsAwarded: z
                  .number()
                  .min(0)
                  .describe("Points awarded for this rubric"),
                maxPoints: z
                  .number()
                  .describe("Maximum points available for this rubric"),
                criterionSelected: z
                  .string()
                  .describe("The specific criterion level selected"),
                justification: z
                  .string()
                  .describe("Detailed justification for the score"),
              }),
            )
            .describe("Individual scores for each rubric criterion")
            .optional(),
          gradingRationale: z
            .string()
            .describe("Internal rationale for ensuring consistent grading"),
        }),
      );
    }

    return singletonParser;
  }

  /**
   * Calculate maximum possible points from scoring criteria
   */
  private calculateMaxPossiblePoints(
    scoringCriteria: ScoringDto,
    defaultTotal: number,
  ): number {
    if (
      !scoringCriteria ||
      !Array.isArray(scoringCriteria.rubrics) ||
      scoringCriteria.rubrics.length === 0
    ) {
      return defaultTotal;
    }

    let maxPoints = 0;
    for (const rubric of scoringCriteria.rubrics) {
      if (rubric?.criteria && Array.isArray(rubric.criteria)) {
        const rubricMax = Math.max(
          0,
          ...rubric.criteria
            .filter((c: CriteriaDto) => typeof c?.points === "number")
            .map((c: CriteriaDto) => c.points),
        );
        maxPoints += rubricMax;
      }
    }

    return maxPoints > 0 ? maxPoints : defaultTotal;
  }

  /**
   * Generate a content hash for consistency checking
   */
  private generateContentHash(
    learnerResponse: string,
    question: string,
  ): string {
    const normalizedResponse = learnerResponse
      .toLowerCase()
      .replaceAll(/[^\s\w]/g, "")
      .replaceAll(/\s+/g, " ")
      .trim()
      .slice(0, 1000);

    const normalizedQuestion = question
      .toLowerCase()
      .replaceAll(/[^\s\w]/g, "")
      .replaceAll(/\s+/g, " ")
      .trim()
      .slice(0, 500);

    const combined = `${normalizedQuestion}:${normalizedResponse}`;
    return Buffer.from(combined).toString("base64").slice(0, 16);
  }

  /**
   * Validate feedback tone alignment with score percentage
   */
  private validateFeedbackAlignment(
    gradingAttempt: GradingAttempt,
    scorePercentage: number,
  ): string | null {
    const feedback = gradingAttempt.feedback || "";
    const explanation = gradingAttempt.explanation || "";
    const guidance = gradingAttempt.guidance || "";
    const allText = `${feedback} ${explanation} ${guidance}`.toLowerCase();

    const positiveWords = [
      "excellent",
      "outstanding",
      "great",
      "strong",
      "impressive",
      "well done",
      "good job",
    ];
    const negativeWords = [
      "poor",
      "weak",
      "inadequate",
      "lacking",
      "missing",
      "incomplete",
      "fails",
      "incorrect",
    ];
    const encouragingWords = ["keep up", "continue", "maintain", "build on"];
    const criticalWords = [
      "needs improvement",
      "must improve",
      "requires work",
      "significant issues",
    ];

    const positiveCount = positiveWords.reduce(
      (count, word) => count + (allText.includes(word) ? 1 : 0),
      0,
    );
    const negativeCount = negativeWords.reduce(
      (count, word) => count + (allText.includes(word) ? 1 : 0),
      0,
    );
    const encouragingCount = encouragingWords.reduce(
      (count, word) => count + (allText.includes(word) ? 1 : 0),
      0,
    );
    const criticalCount = criticalWords.reduce(
      (count, word) => count + (allText.includes(word) ? 1 : 0),
      0,
    );

    if (
      scorePercentage >= 85 &&
      (negativeCount > positiveCount || criticalCount > encouragingCount)
    ) {
      return `High score (${Math.round(
        scorePercentage,
      )}%) but overly negative feedback tone`;
    }

    if (
      scorePercentage <= 40 &&
      (positiveCount > negativeCount || encouragingCount > criticalCount)
    ) {
      return `Low score (${Math.round(
        scorePercentage,
      )}%) but overly positive feedback tone`;
    }

    if (
      scorePercentage >= 70 &&
      scorePercentage < 85 &&
      negativeCount > positiveCount + 2
    ) {
      return `Good score (${Math.round(
        scorePercentage,
      )}%) but excessively critical feedback`;
    }

    return null;
  }

  /**
   * Convert optional rubric scores to required format
   */
  private ensureRequiredRubricFields(
    rubricScores?: RubricScore[],
  ): RubricScore[] {
    if (!rubricScores || !Array.isArray(rubricScores)) {
      return [];
    }

    return rubricScores.map((score, index) => ({
      rubricQuestion: score.rubricQuestion || `Rubric ${index + 1}`,
      pointsAwarded: score.pointsAwarded || 0,
      maxPoints: score.maxPoints || 0,
      criterionSelected: score.criterionSelected || "Default criterion",
      justification: score.justification || "Auto-generated justification",
    }));
  }

  /**
   * Generate ultra-concise feedback - no redundancy
   */
  private generateAlignedFeedback(
    gradingAttempt: GradingAttempt,
    maxPossiblePoints: number,
  ): string {
    const percentage =
      maxPossiblePoints > 0
        ? Math.round((gradingAttempt.points / maxPossiblePoints) * 100)
        : 0;

    const conciseFeedback = `${gradingAttempt.explanation}

${gradingAttempt.guidance}

**Score: ${gradingAttempt.points}/${maxPossiblePoints} (${percentage}%)**`.trim();

    return conciseFeedback;
  }

  /**
   * Get contextual introduction based on score percentage
   */
  private getScoreContext(percentage: number): string {
    if (percentage >= 95) {
      return "You achieved an outstanding score.";
    } else if (percentage >= 90) {
      return "You achieved an excellent score.";
    } else if (percentage >= 85) {
      return "You achieved a very good score.";
    } else if (percentage >= 80) {
      return "You achieved a good score.";
    } else if (percentage >= 75) {
      return "You achieved an above average score.";
    } else if (percentage >= 70) {
      return "You achieved a satisfactory score.";
    } else if (percentage >= 65) {
      return "You achieved an adequate score with room for improvement.";
    } else if (percentage >= 60) {
      return "Your score indicates areas for improvement.";
    } else if (percentage >= 50) {
      return "Your score indicates significant room for improvement.";
    } else {
      return "Your score indicates substantial areas needing improvement.";
    }
  }

  /**
   * Format judge feedback to be more actionable for the grading assistant
   */
  private formatJudgeFeedbackForTA(
    judgeResult: {
      feedback?: string;
      issues?: string[];
      corrections?: {
        points?: number;
        feedback?: string;
        rubricScores?: unknown[];
      };
    },
    attemptNumber: number,
  ): string {
    let formattedFeedback = `📋 GRADING FEEDBACK - ATTEMPT ${attemptNumber}:\n\n`;

    if (judgeResult.issues && Array.isArray(judgeResult.issues)) {
      formattedFeedback += `🚨 CRITICAL ISSUES TO FIX:\n`;
      for (const [index, issue] of judgeResult.issues.entries()) {
        formattedFeedback += `${index + 1}. ${issue}\n`;
      }
      formattedFeedback += "\n";
    }

    const feedback = judgeResult.feedback || "";
    formattedFeedback += `📝 DETAILED FEEDBACK:\n${feedback}\n\n`;

    if (judgeResult.corrections) {
      formattedFeedback += `✅ REQUIRED CORRECTIONS:\n`;
      if (judgeResult.corrections.points !== undefined) {
        formattedFeedback += `• Adjust total points to: ${judgeResult.corrections.points}\n`;
      }
      if (judgeResult.corrections.feedback) {
        formattedFeedback += `• Update feedback: ${judgeResult.corrections.feedback}\n`;
      }
      if (judgeResult.corrections.rubricScores) {
        formattedFeedback += `• Fix rubric scores as specified\n`;
      }
      formattedFeedback += "\n";
    }

    formattedFeedback += `🎯 WHAT YOU MUST DO DIFFERENTLY:\n`;
    if (feedback.includes("mathematical")) {
      formattedFeedback += `• Double-check ALL math: Total points MUST equal sum of rubric scores\n`;
    }
    if (feedback.includes("feedback") && feedback.includes("align")) {
      formattedFeedback += `• Ensure your explanations clearly justify the scores given\n`;
      formattedFeedback += `• Use specific student quotes as evidence for each point awarded/deducted\n`;
    }
    if (feedback.includes("rubric")) {
      formattedFeedback += `• Follow rubric criteria exactly - pick the ONE criterion that best fits\n`;
      formattedFeedback += `• Use EXACT point values from the criteria, no custom points\n`;
    }
    if (feedback.includes("specific") || feedback.includes("evidence")) {
      formattedFeedback += `• Quote specific parts of the student response to justify scores\n`;
      formattedFeedback += `• Provide concrete evidence for every point awarded or deducted\n`;
    }

    formattedFeedback += `\n💡 REMEMBER: This feedback helps you improve accuracy. Learn from it!`;

    return formattedFeedback;
  }

  /**
   * Utility function for delays
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Load the enhanced text grading template with robust validation
   */
  private loadEnhancedTextGradingTemplate(): string {
    return `
    You are an educational grading assistant helping evaluate student work fairly and accurately.
    
    PREVIOUS FEEDBACK: {judge_feedback}
    If feedback above exists, please address the issues mentioned.
    
    STUDENT RESPONSE TO GRADE:
    {learner_response}
    
    DETAILED RUBRIC CRITERIA AND SCORING:
    {scoring_criteria}
    Max Points Available: {total_points}
    
    CRITICAL INSTRUCTIONS:
    
    1. CAREFULLY examine each rubric question and its scoring criteria
    2. For each rubric, select the ONE criterion that BEST matches the student's response
    3. Use the EXACT point value from the selected criterion - no custom points allowed
    4. Your total points MUST equal the sum of all rubric scores
    5. Quote specific parts of the student response as evidence for your scoring decisions
    6. Provide constructive feedback based on what you observe
    
    RUBRIC SCORING REQUIREMENTS:
    - You must score ALL rubric questions provided in the criteria
    - Each rubric score must use a valid point value from its criteria options
    - Justify each score with specific evidence from the student response
    - Total points = sum of all individual rubric scores (this is mandatory)
    
    Question: {question}
    Assignment Instructions: {assignment_instructions}
    Language: {language}

    Make sure your feedback is short and concise.

    {format_instructions}
    `;
  }
}
