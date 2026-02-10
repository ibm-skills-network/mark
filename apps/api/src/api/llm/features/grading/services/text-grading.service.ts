/* eslint-disable unicorn/no-null */
import { createHash } from "node:crypto";
import { PromptTemplate } from "@langchain/core/prompts";
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Optional,
} from "@nestjs/common";
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
  StructuredFeedbackData,
  TextBasedQuestionResponseModel,
} from "src/api/llm/model/text.based.question.response.model";
import { Logger } from "winston";
import { z } from "zod";
import { IModerationService } from "../../../core/interfaces/moderation.interface";
import { IPromptProcessor } from "../../../core/interfaces/prompt-processor.interface";
import {
  ANSWER_NORMALIZATION_SERVICE,
  GRADING_CACHE_SERVICE,
  GRADING_JUDGE_SERVICE,
  MODERATION_SERVICE,
  PROMPT_PROCESSOR,
  RESPONSE_TYPE_SPECIFIC_INSTRUCTIONS,
} from "../../../llm.constants";
import {
  IAnswerNormalizationService,
  INormalizedAnswer,
} from "../interfaces/answer-normalization.interface";
import { IGradingCacheService } from "../interfaces/grading-cache.interface";
import { IGradingJudgeService } from "../interfaces/grading-judge.interface";
import { ITextGradingService } from "../interfaces/text-grading.interface";
import {
  DEFAULT_MODEL_SELECTION,
  EvidenceAuditLog,
  GradeSummary,
  JudgeCritique,
  RubricCriterion,
} from "../types/criterion-evidence.types";
import { CriterionEvidencePipelineService } from "./criterion-evidence-pipeline.service";
import { EvidenceChunkingService } from "./evidence-chunking.service";

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
  totalScore: z
    .number()
    .min(0)
    .describe("Total points awarded (must equal sum of all criterion scores)"),
  maxScore: z.number().min(0).describe("Maximum possible points"),
  criteria: z
    .array(
      z.object({
        criterionId: z
          .string()
          .describe("Unique identifier for this criterion from the rubric"),
        pointsAwarded: z
          .number()
          .min(0)
          .describe(
            "Points awarded for this criterion (must match rubric value exactly)",
          ),
        maxPoints: z
          .number()
          .min(0)
          .describe("Maximum points for this criterion"),
        evidence: z
          .string()
          .nullable()
          .describe(
            "Direct quote from submission as evidence, or null if criterion not met",
          ),
        feedback: z
          .string()
          .describe(
            "Evidence-based feedback: state if met/not met, cite evidence or state 'No supporting evidence found'",
          ),
      }),
    )
    .describe("Evaluation of each criterion independently"),
  overallFeedback: z
    .string()
    .describe(
      "Concise summary of performance across all criteria (factual, no subjective language)",
    ),
});

export type GradingAttempt = z.infer<typeof GradingAttemptSchema>;

let singletonParser: StructuredOutputParser<
  typeof GradingAttemptSchema
> | null = null;

@Injectable()
export class TextGradingService implements ITextGradingService {
  private readonly logger: Logger;
  private readonly maxRetries = 1;
  private readonly retryDelay = 1000;

  constructor(
    @Inject(PROMPT_PROCESSOR)
    private readonly promptProcessor: IPromptProcessor,
    @Inject(MODERATION_SERVICE)
    private readonly moderationService: IModerationService,
    private readonly chunkingService: EvidenceChunkingService,
    private readonly evidencePipeline: CriterionEvidencePipelineService,
    @Inject(GRADING_JUDGE_SERVICE)
    private readonly gradingJudgeService: IGradingJudgeService,
    @Optional()
    @Inject(ANSWER_NORMALIZATION_SERVICE)
    private readonly normalizationService?: IAnswerNormalizationService,
    @Optional()
    @Inject(GRADING_CACHE_SERVICE)
    private readonly cacheService?: IGradingCacheService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger?: Logger,
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
      const {
        question,
        learnerResponse,
        totalPoints,
        scoringCriteria,
        scoringCriteriaType,
        questionId,
      } = textBasedQuestionEvaluateModel;

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

      const rubricCriteria = this.convertToRubricCriteria(
        scoringCriteria as ScoringDto,
      );

      if (
        scoringCriteriaType === "CRITERIA_BASED" &&
        rubricCriteria.length > 0
      ) {
        const pipelineResult = await this.evidencePipeline.gradeWithEvidence({
          question,
          criteria: rubricCriteria,
          chunks: this.chunkingService.extractFromText(
            sanitizedLearnerResponse,
            questionId ? `question-${questionId}` : "learner-response",
          ),
          assignmentId,
          language,
          maxConcurrency: 8,
          maxRetries: 3,
          modelOverrides: DEFAULT_MODEL_SELECTION,
        });

        return this.buildTextResponseFromPipeline(
          pipelineResult,
          maxPossiblePoints,
          startTime,
        );
      }

      let normalizedAnswer: INormalizedAnswer | null = null;
      let rubricHash: string | null = null;
      let cacheKey: string | null = null;

      if (this.normalizationService) {
        normalizedAnswer = this.normalizationService.normalizeAnswer(
          sanitizedLearnerResponse,
        );
        rubricHash = this.normalizationService.hashRubric(
          JSON.stringify(scoringCriteria),
        );
        cacheKey = this.normalizationService.generateCacheKey(
          rubricHash,
          normalizedAnswer.hash,
          questionId,
        );

        this.logger.info(
          `Normalized answer - Hash: ${normalizedAnswer.hash}, ` +
            `Words: ${normalizedAnswer.wordCount}, ` +
            `Claims: ${normalizedAnswer.claims.length}`,
        );

        if (this.cacheService && cacheKey && normalizedAnswer) {
          const cached = await this.cacheService.getCachedGrading(cacheKey);
          if (cached) {
            this.logger.info(
              `Cache hit! Returning cached grading (hit count: ${cached.hitCount})`,
            );

            const endTime = Date.now();
            const metadata: GradingMetadata = {
              judgeApproved: true,
              attempts: 1,
              gradingTimeMs: endTime - startTime,
              contentHash: normalizedAnswer.hash,
              cached: true,
              cacheHitCount: cached.hitCount,
              maxPossiblePoints,
            };

            const rubricScores = cached.criteria.map((criterion) => ({
              rubricQuestion: criterion.criterionId,
              pointsAwarded: criterion.pointsAwarded,
              maxPoints: criterion.maxPoints,
              criterionSelected:
                criterion.pointsAwarded > 0 ? "Met" : "Not Met",
              justification: criterion.feedback,
            }));

            const summary = this.generateScoreExplanation(
              cached.totalScore,
              maxPossiblePoints,
              cached.criteria,
            );
            const details = this.generateCriteriaBasedFeedback(cached.criteria);
            const guidance = this.generateGuidanceFromCriteria(cached.criteria);

            const structuredFeedback = `${summary}\n\n---\n\n${details}\n\nGuidance: ${guidance}`;

            const structuredData = this.buildStructuredFeedbackData(
              summary,
              cached.criteria,
              guidance,
            );

            return new TextBasedQuestionResponseModel(
              cached.totalScore,
              structuredFeedback,
              "",
              "",
              summary,
              guidance,
              rubricScores,
              `Cached result (used ${cached.hitCount} times) - deterministic grading`,
              metadata,
              structuredData,
            );
          }
        }
      }

      const contentHash =
        normalizedAnswer?.hash ||
        this.generateContentHash(learnerResponse, question);

      let gradingAttempt: GradingAttempt | null = null;
      let attemptCount = 0;

      while (!gradingAttempt && attemptCount < this.maxRetries) {
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
          );
        } catch (error) {
          this.logger.error(
            `Error in grading attempt ${attemptCount}: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          );

          if (attemptCount < this.maxRetries) {
            const backoffDelay =
              this.retryDelay * Math.pow(2, attemptCount - 1);
            await this.delay(Math.min(backoffDelay, 5000));
          }
        }
      }

      if (!gradingAttempt) {
        throw new HttpException(
          "Failed to generate grading after all attempts",
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      const judgeResult = await this.validateWithJudge(
        question,
        sanitizedLearnerResponse,
        scoringCriteria as ScoringDto,
        gradingAttempt,
        maxPossiblePoints,
        assignmentId,
      );

      const judgeApproved = judgeResult.approved;

      if (!judgeResult.approved) {
        this.logger.warn(
          `Judge rejected grading: ${judgeResult.feedback || "No feedback"}`,
        );

        if (judgeResult.corrections) {
          gradingAttempt = this.applyJudgeCorrections(
            gradingAttempt,
            judgeResult.corrections,
          );
        }

        gradingAttempt = this.applyJudgeFeedbackOverlay(
          gradingAttempt,
          judgeResult,
        );
      }

      const normalizedAttempt = this.normalizeGradingAttempt(
        gradingAttempt,
        maxPossiblePoints,
      );

      const endTime = Date.now();
      this.logger.info(
        `Graded text question - Points: ${normalizedAttempt.totalScore}/${maxPossiblePoints}, ` +
          `Content Hash: ${contentHash}, Judge Approved: ${judgeApproved.toString()}, ` +
          `Time: ${endTime - startTime}ms, Attempts: ${attemptCount}`,
      );

      const metadata: GradingMetadata = {
        judgeApproved,
        judgeUsed: true,
        attempts: attemptCount,
        gradingTimeMs: endTime - startTime,
        contentHash,
        maxPossiblePoints,
      };

      const rubricScores = normalizedAttempt.criteria.map((criterion) => ({
        rubricQuestion: criterion.criterionId,
        pointsAwarded: criterion.pointsAwarded,
        maxPoints: criterion.maxPoints,
        criterionSelected: criterion.pointsAwarded > 0 ? "Met" : "Not Met",
        justification: criterion.feedback,
      }));

      if (
        this.cacheService &&
        cacheKey &&
        rubricHash &&
        normalizedAnswer &&
        questionId
      ) {
        try {
          const validatedCriteria = normalizedAttempt.criteria.map((c) => ({
            criterionId: c.criterionId || "",
            pointsAwarded: c.pointsAwarded || 0,
            maxPoints: c.maxPoints || 0,
            evidence: c.evidence || null,
            feedback: c.feedback || "",
          }));

          await this.cacheService.cacheGrading({
            cacheKey,
            questionId,
            rubricHash,
            answerHash: normalizedAnswer.hash,
            totalScore: normalizedAttempt.totalScore,
            maxScore: normalizedAttempt.maxScore,
            criteria: validatedCriteria,
            overallFeedback: normalizedAttempt.overallFeedback,
            cachedAt: new Date(),
            hitCount: 0,
            metadata: {
              gradingTimeMs: endTime - startTime,
              attempts: attemptCount,
              judgeApproved,
            },
          });

          this.logger.info(`Cached grading result with key: ${cacheKey}`);
        } catch (cacheError) {
          this.logger.warn(
            `Failed to cache grading result: ${
              cacheError instanceof Error ? cacheError.message : "Unknown error"
            }`,
          );
        }
      }

      const summary = this.generateScoreExplanation(
        normalizedAttempt.totalScore,
        maxPossiblePoints,
        normalizedAttempt.criteria,
      );
      const details = this.generateCriteriaBasedFeedback(
        normalizedAttempt.criteria,
      );
      const guidance = this.generateGuidanceFromCriteria(
        normalizedAttempt.criteria,
      );

      const structuredFeedback = `${summary}\n\n---\n\n${details}\n\nGuidance: ${guidance}`;

      const structuredData = this.buildStructuredFeedbackData(
        summary,
        normalizedAttempt.criteria,
        guidance,
      );

      return new TextBasedQuestionResponseModel(
        normalizedAttempt.totalScore,
        structuredFeedback,
        "",
        "",
        summary,
        guidance,
        rubricScores,
        `Deterministic grading: ${normalizedAttempt.criteria.length} criteria evaluated`,
        metadata,
        structuredData,
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
   * Normalize a grading attempt by clamping criterion scores and total points to valid ranges.
   */
  private normalizeGradingAttempt(
    attempt: GradingAttempt,
    maxPossiblePoints: number,
  ): GradingAttempt {
    const cloned: GradingAttempt = { ...attempt };

    const normalizedCriteria = cloned.criteria.map((criterion, index) => {
      const maxPoints = Math.max(0, Number(criterion.maxPoints ?? 0));
      const awardedRaw = Number(criterion.pointsAwarded ?? 0);
      const awarded = Math.min(Math.max(0, awardedRaw), maxPoints);

      if (awarded !== awardedRaw) {
        this.logger.warn(
          `Clamped criterion "${criterion.criterionId}" score from ${awardedRaw} to ${awarded} (max ${maxPoints})`,
        );
      }

      return {
        criterionId: criterion.criterionId || `criterion_${index}`,
        pointsAwarded: awarded,
        maxPoints: maxPoints,
        evidence: criterion.evidence,
        feedback: criterion.feedback || "No feedback provided",
      };
    });

    const totalFromCriteria = normalizedCriteria.reduce(
      (sum, c) => sum + c.pointsAwarded,
      0,
    );

    const cappedTotal = Math.min(
      Math.max(0, totalFromCriteria),
      maxPossiblePoints,
    );

    if (cappedTotal !== cloned.totalScore) {
      this.logger.warn(
        `Normalized total score from ${cloned.totalScore} to ${cappedTotal} (max ${maxPossiblePoints})`,
      );
    }

    return {
      totalScore: cappedTotal,
      maxScore: maxPossiblePoints,
      criteria: normalizedCriteria,
      overallFeedback: cloned.overallFeedback || "Grading completed",
    };
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
      { temperature: 0, top_p: 0 },
    );

    const parsedResponse = await parser.parse(response);

    this.logger.info(
      `LLM grading result - Points: ${parsedResponse.totalScore}/${maxPossiblePoints}, ` +
        `Criteria evaluated: ${parsedResponse.criteria?.length || 0} items`,
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
      const rubricScores: RubricScore[] = gradingAttempt.criteria.map(
        (criterion, index) => {
          const awarded = criterion.pointsAwarded || 0;
          const max = criterion.maxPoints || 0;
          const status =
            awarded >= max ? "full" : awarded > 0 ? "partial" : "none";

          return {
            rubricQuestion: criterion.criterionId || `criterion_${index + 1}`,
            pointsAwarded: awarded,
            maxPoints: max,
            justification: criterion.feedback || "No feedback provided",
            evidence: criterion.evidence ? [criterion.evidence] : [],
            status,
          };
        },
      );

      return await this.gradingJudgeService.validateGrading({
        question,
        learnerResponse,
        scoringCriteria,
        proposedGrading: {
          points: gradingAttempt.totalScore,
          maxPoints: maxPossiblePoints,
          feedback: gradingAttempt.overallFeedback,
          rubricScores,
          analysis: "",
          evaluation: "",
          explanation: gradingAttempt.overallFeedback,
          guidance: this.generateGuidanceFromCriteria(gradingAttempt.criteria),
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
   * Generate criteria-based feedback showing each criterion's result
   */
  private generateCriteriaBasedFeedback(
    criteria: Array<{
      criterionId?: string;
      pointsAwarded?: number;
      maxPoints?: number;
      evidence?: string | null;
      feedback?: string;
    }>,
  ): string {
    if (!criteria || criteria.length === 0) {
      return "No grading criteria available.";
    }

    const feedbackSections = criteria.map((c, index) => {
      const awarded = c.pointsAwarded || 0;
      const max = c.maxPoints || 0;
      const criterionName = c.criterionId || `Criterion ${index + 1}`;
      const status = awarded >= max ? "✓" : awarded > 0 ? "◐" : "✗";

      let section = `${status} **${criterionName}** (${awarded}/${max} points)\n`;

      if (
        c.evidence &&
        c.evidence.trim() !== "No supporting evidence found in the submission."
      ) {
        section += `Evidence: "${c.evidence}"\n`;
      }

      section += `${c.feedback || "No feedback provided"}\n`;

      return section;
    });

    return feedbackSections.join("\n");
  }

  /**
   * Generate clear score explanation
   */
  private generateScoreExplanation(
    totalScore: number,
    maxScore: number,
    criteria: Array<{
      criterionId?: string;
      pointsAwarded?: number;
      maxPoints?: number;
    }>,
  ): string {
    const percentage =
      maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;

    const breakdown = criteria
      .map((c) => {
        const awarded = c.pointsAwarded || 0;
        const max = c.maxPoints || 0;
        return `${c.criterionId}: ${awarded}/${max}`;
      })
      .join(", ");

    return `Score: ${totalScore}/${maxScore} points (${percentage}%). Breakdown: ${breakdown}`;
  }

  /**
   * Build structured feedback data for frontend
   */
  private buildStructuredFeedbackData(
    summary: string,
    criteria: Array<{
      criterionId?: string;
      pointsAwarded?: number;
      maxPoints?: number;
      evidence?: string | null;
      feedback?: string;
    }>,
    guidance: string,
  ): StructuredFeedbackData {
    const structuredCriteria = criteria.map((c) => {
      const awarded = c.pointsAwarded || 0;
      const max = c.maxPoints || 0;

      let status: "full" | "partial" | "none";
      if (awarded >= max && max > 0) {
        status = "full";
      } else if (awarded > 0) {
        status = "partial";
      } else {
        status = "none";
      }

      return {
        name: c.criterionId || "",
        pointsAwarded: awarded,
        maxPoints: max,
        status,
        evidence: c.evidence || "",
        feedback: c.feedback || "",
      };
    });

    return {
      summary,
      criteria: structuredCriteria,
      guidance,
    };
  }

  /**
   * Generate guidance text from criteria (both partially met and unmet)
   */
  private generateGuidanceFromCriteria(
    criteria: Array<{
      criterionId?: string;
      pointsAwarded?: number;
      maxPoints?: number;
      evidence?: string | null;
      feedback?: string;
    }>,
  ): string {
    const allFullyMet = criteria.every((c) => {
      const awarded = c.pointsAwarded || 0;
      const max = c.maxPoints || 0;
      return max > 0 && awarded >= max;
    });

    if (allFullyMet) {
      return "All grading criteria fully satisfied.";
    }

    const improvementAreas = criteria
      .filter((c) => {
        const awarded = c.pointsAwarded || 0;
        const max = c.maxPoints || 0;
        return awarded < max;
      })
      .map((c) => {
        return ` ${c.feedback || "No feedback provided"}`;
      })
      .join("\n");

    return improvementAreas.length > 0
      ? `To improve your score:\n${improvementAreas}`
      : "Review criteria for potential improvements.";
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
      corrected.totalScore = corrections.points;
    }

    if (corrections.feedback) {
      corrected.overallFeedback = `${corrected.overallFeedback}\n\nJudge Adjustment: ${corrections.feedback}`;
    }

    if (corrections.rubricScores && Array.isArray(corrections.rubricScores)) {
      corrected.criteria = corrections.rubricScores.map((score, index) => ({
        criterionId: score.rubricQuestion || `criterion_${index}`,
        pointsAwarded: score.pointsAwarded || 0,
        maxPoints: score.maxPoints || 0,
        evidence: null,
        feedback: score.justification || "No feedback provided",
      }));

      corrected.totalScore = corrected.criteria.reduce(
        (sum, c) => sum + c.pointsAwarded,
        0,
      );
    }

    return corrected;
  }

  /**
   * Append judge feedback without re-grading the submission
   */
  private applyJudgeFeedbackOverlay(
    gradingAttempt: GradingAttempt,
    judgeResult: {
      feedback?: string;
      issues?: string[];
      corrections?: {
        feedback?: string;
      };
    },
  ): GradingAttempt {
    const overlayParts: string[] = [];

    if (judgeResult.feedback) {
      overlayParts.push(judgeResult.feedback);
    }

    if (Array.isArray(judgeResult.issues) && judgeResult.issues.length > 0) {
      overlayParts.push(
        `Issues: ${judgeResult.issues.map((issue) => issue.trim()).join("; ")}`,
      );
    }

    if (overlayParts.length === 0) {
      return gradingAttempt;
    }

    const overlayText = overlayParts.join("\n");

    return {
      ...gradingAttempt,
      overallFeedback: `${gradingAttempt.overallFeedback}\n\nJudge Review:\n${overlayText}`,
    };
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
      singletonParser =
        StructuredOutputParser.fromZodSchema(GradingAttemptSchema);
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
   * Validate that feedback contains no subjective language
   */
  private validateNoSubjectiveLanguage(feedback: string): boolean {
    const subjectiveWords = [
      "excellent",
      "outstanding",
      "great",
      "strong",
      "impressive",
      "well done",
      "good job",
      "poor",
      "weak",
      "nice",
      "wonderful",
      "fantastic",
      "brilliant",
      "superb",
    ];

    const lowerFeedback = feedback.toLowerCase();
    return !subjectiveWords.some((word) => lowerFeedback.includes(word));
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
   * Load the deterministic grading template
   */
  private loadEnhancedTextGradingTemplate(): string {
    return `You are an automated grading engine. Your task is to evaluate learner submissions using ONLY the provided grading rubric.

MANDATORY RULES:
1. Grade strictly per criterion - do NOT invent new criteria
2. Assign points ONLY if the criterion is explicitly satisfied
3. If evidence is missing, unclear, or incorrect → assign 0 points
4. Similar submissions must receive identical scores and feedback
5. Do NOT use subjective language ("good", "strong", "weak", "excellent", "poor", "nice")
6. Every point deduction MUST be explained with evidence from the submission
7. Quote exact phrases from the submission as evidence
8. Do NOT infer intent or give credit for unstated information
9. Do NOT compare learners to others or give encouragement

FEEDBACK REQUIREMENTS FOR EACH CRITERION:
1. **evidence**: Quote the specific text from the learner's submission that relates to this criterion
   - If the criterion is met: Quote the relevant part that satisfies it
   - If NOT met: Write "No supporting evidence found in the submission."

2. **feedback**: Provide constructive, learner-focused feedback
   - Focus on what the learner DID or DID NOT include in their answer
   - If FULLY met: Acknowledge what was correctly explained or demonstrated
   - If PARTIALLY met: Point out what was included AND what specific elements are missing
   - If NOT met: Explain what specific information or concepts are absent from the answer
   - Be specific about gaps: name the missing concepts, explanations, or details
   - Frame as actionable guidance: "The answer should include..." or "Consider adding..."
   - NO criterion requirements, NO subjective adjectives, NO encouragement, NO praise
   - Do NOT start with "Criterion requires..." or similar phrasing

EXAMPLE OF GOOD FEEDBACK:
Criterion: "Explain how React components communicate via props"
Points Awarded: 2/4
Evidence: "Components can pass data through attributes called props."
Feedback: "The answer mentions that props are used for passing data, which is correct. However, it lacks explanation of the parent-to-child data flow direction and how parent components actually pass props to their children. Consider adding details about unidirectional data flow and the syntax for passing props."

EXAMPLE OF BAD FEEDBACK (DO NOT DO THIS):
Criterion: "Explain how React components communicate via props"
Points Awarded: 2/4
Evidence: "The submission discusses props."
Feedback: "Criterion requires explanation of HOW props enable communication. The submission does not explain the communication mechanism."
❌ Problems: States criterion requirements, vague evidence, doesn't provide constructive guidance

ANTI-HALLUCINATION RULE:
If evidence is not explicitly in the submission, you MUST write:
"No supporting evidence found in the submission."

PREVIOUS JUDGE FEEDBACK (if any): {judge_feedback}

---

### Question
{question}

### Assignment Instructions
{assignment_instructions}

### Grading Rubric
{scoring_criteria}

Maximum Points: {total_points}

### Learner Submission
{learner_response}

### Your Task
For each criterion:
1. Read the criterion requirements carefully
2. Search the learner submission for evidence
3. Quote the relevant text in the "evidence" field
4. Award points based on whether requirements are met
5. Provide constructive feedback focused on what the learner included or omitted, and how to improve

Language for response: {language}

{format_instructions}`;
  }

  private convertToRubricCriteria(
    scoringCriteria?: ScoringDto,
  ): RubricCriterion[] {
    if (!scoringCriteria || !Array.isArray(scoringCriteria.rubrics)) {
      return [];
    }

    return scoringCriteria.rubrics.map((rubric, index) => {
      const maxPoints = Math.max(
        ...rubric.criteria.map((criterion) => criterion.points || 0),
      );

      return {
        id: `rubric-${index + 1}`,
        rubricQuestion: rubric.rubricQuestion || `Criterion ${index + 1}`,
        description: rubric.rubricQuestion || `Criterion ${index + 1}`,
        criteria: rubric.criteria.map((criterion) => ({
          description: criterion.description,
          points: criterion.points,
        })),
        maxPoints: maxPoints || 0,
      };
    });
  }

  private buildTextResponseFromPipeline(
    pipelineResult: {
      grades: Array<{
        criterionId: string;
        rubricQuestion: string;
        pointsAwarded: number;
        maxPoints: number;
        rationale: string;
        citations: string[];
        decision: "meets" | "partially_meets" | "does_not_meet";
      }>;
      summary: GradeSummary;
      judgeCritiques: JudgeCritique[];
      audit: EvidenceAuditLog;
    },
    maxPossiblePoints: number,
    startTime: number,
  ): TextBasedQuestionResponseModel {
    const totalPoints = Math.min(
      pipelineResult.summary.totalPoints,
      maxPossiblePoints,
    );

    const rubricScores: RubricScore[] = pipelineResult.grades.map((grade) => ({
      rubricQuestion: grade.rubricQuestion,
      pointsAwarded: grade.pointsAwarded,
      maxPoints: grade.maxPoints,
      justification: grade.rationale,
      evidence: grade.citations,
      status:
        grade.decision === "meets"
          ? "full"
          : grade.decision === "partially_meets"
            ? "partial"
            : "none",
    }));

    const feedbackLines = pipelineResult.grades.map(
      (grade) =>
        `**${grade.rubricQuestion}** (${grade.pointsAwarded}/${grade.maxPoints})\n${grade.rationale}`,
    );
    const feedback = feedbackLines.join("\n\n");

    const structuredFeedback: StructuredFeedbackData = {
      summary: `Total Score: ${totalPoints}/${pipelineResult.summary.maxPoints}`,
      criteria: pipelineResult.grades.map((grade) => ({
        name: grade.rubricQuestion,
        pointsAwarded: grade.pointsAwarded,
        maxPoints: grade.maxPoints,
        status:
          grade.decision === "meets"
            ? "full"
            : grade.decision === "partially_meets"
              ? "partial"
              : "none",
        evidence: grade.citations.join(", ") || "No evidence cited",
        feedback: grade.rationale,
      })),
      guidance: pipelineResult.grades.map((grade) => grade.rationale).join(" "),
    };

    const contentHash = createHash("sha256")
      .update(pipelineResult.audit.chunkHashes.join("|"))
      .digest("hex");

    const latestJudge = pipelineResult.judgeCritiques.at(-1);

    const metadata: GradingMetadata = {
      judgeApproved: latestJudge?.approved ?? false,
      judgeUsed: true,
      attempts: pipelineResult.judgeCritiques.length,
      gradingTimeMs: Date.now() - startTime,
      contentHash,
      maxPossiblePoints,
      ...(pipelineResult.audit ? { gradingAudit: pipelineResult.audit } : {}),
    };

    return new TextBasedQuestionResponseModel(
      totalPoints,
      feedback,
      undefined,
      undefined,
      undefined,
      undefined,
      rubricScores,
      undefined,
      metadata,
      structuredFeedback,
    );
  }
}
