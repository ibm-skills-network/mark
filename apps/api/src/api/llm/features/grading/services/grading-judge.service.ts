// src/llm/features/grading/services/grading-judge.service.ts
import { PromptTemplate } from "@langchain/core/prompts";
import { Inject, Injectable } from "@nestjs/common";
import { AIUsageType } from "@prisma/client";
import { StructuredOutputParser } from "langchain/output_parsers";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { RubricScore } from "src/api/llm/model/file.based.question.response.model";
import { Logger } from "winston";
import { z } from "zod";
import { IPromptProcessor } from "../../../core/interfaces/prompt-processor.interface";
import { LLMResolverService } from "../../../core/services/llm-resolver.service";
import { LLM_RESOLVER_SERVICE, PROMPT_PROCESSOR } from "../../../llm.constants";
import { IGradingJudgeService } from "../interfaces/grading-judge.interface";

export interface GradingJudgeInput {
  question: string;
  learnerResponse: string;
  scoringCriteria: any;
  proposedGrading: {
    points: number;
    maxPoints: number;
    feedback: string;
    rubricScores?: RubricScore[];
    analysis?: string;
    evaluation?: string;
    explanation?: string;
    guidance?: string;
  };
  assignmentId: number;
}

export interface GradingJudgeResult {
  approved: boolean;
  feedback: string;
  issues?: string[];
  corrections?: {
    points?: number;
    feedback?: string;
    rubricScores?: RubricScore[];
  };
}

const ParsedJudgeResponseSchema = z.object({
  approved: z.boolean(),
  feedback: z.string(),
  issues: z.array(z.string()).optional(),
  mathematicallyCorrect: z.boolean().nullable().optional(),
  feedbackAligned: z.boolean(),
  rubricAdherence: z.boolean(),
  fairnessScore: z.number().min(0).max(10),
  suggestedPoints: z.number().nullable().optional(),
  suggestedFeedbackChanges: z.string().nullable().optional(),
  correctedRubricScores: z
    .array(
      z.object({
        rubricQuestion: z.string(),
        pointsAwarded: z.number(),
        maxPoints: z.number(),
        criterionSelected: z.string(),
        justification: z.string(),
      }),
    )
    .nullable()
    .optional(),
});

type ParsedJudgeResponse = z.infer<typeof ParsedJudgeResponseSchema>;

const judgeParserCache = new WeakMap<any, StructuredOutputParser<any>>();

@Injectable()
export class GradingJudgeService implements IGradingJudgeService {
  private readonly logger: Logger;
  private readonly maxJudgeTimeout = 120_000; // Increased from 60s to 120s

  constructor(
    @Inject(PROMPT_PROCESSOR)
    private readonly promptProcessor: IPromptProcessor,
    @Inject(LLM_RESOLVER_SERVICE)
    private readonly llmResolver: LLMResolverService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: GradingJudgeService.name });
  }

  async validateGrading(input: GradingJudgeInput): Promise<GradingJudgeResult> {
    const startTime = Date.now();

    try {
      this.logger.info(
        `Judge validating grading for assignment ${input.assignmentId}`,
      );

      this.validateInput(input);

      const parser = this.getOrCreateParser();
      const formatInstructions = parser.getFormatInstructions();

      // REMOVED: Arithmetic calculations - Judge LLM should not do mathematical validation
      this.logger.info(
        `Judge will focus on qualitative assessment only, ignoring mathematical calculations`,
      );

      const template = this.loadJudgeTemplate();

      const prompt = new PromptTemplate({
        template,
        inputVariables: [],
        partialVariables: {
          question: () => input.question || "No question provided",
          learner_response: () =>
            input.learnerResponse || "No response provided",
          scoring_criteria: () => JSON.stringify(input.scoringCriteria || {}),
          proposed_points: () => String(input.proposedGrading.points || 0),
          max_points: () => String(input.proposedGrading.maxPoints || 0),
          proposed_feedback: () =>
            input.proposedGrading.feedback || "No feedback provided",
          proposed_analysis: () =>
            input.proposedGrading.analysis || "Not provided",
          proposed_evaluation: () =>
            input.proposedGrading.evaluation || "Not provided",
          proposed_explanation: () =>
            input.proposedGrading.explanation || "Not provided",
          proposed_guidance: () =>
            input.proposedGrading.guidance || "Not provided",
          proposed_rubric_scores: () =>
            JSON.stringify(input.proposedGrading.rubricScores || []),
          format_instructions: () => formatInstructions,
        },
      });

      // Use validation-optimized model selection (gpt-4o-mini for validation tasks)
      const selectedModel = await this.llmResolver.getModelForValidationTask(
        "text_grading",
        (
          input.question +
          input.learnerResponse +
          JSON.stringify(input.scoringCriteria)
        ).length,
      );

      const response = await this.processWithTimeout(
        this.promptProcessor.processPromptForFeature(
          prompt,
          input.assignmentId,
          AIUsageType.GRADING_VALIDATION,
          "content_moderation",
          selectedModel,
        ),
        this.maxJudgeTimeout,
      );

      const parsedResponse = await parser.parse(response);
      const result = this.buildJudgeResult(parsedResponse, input);

      const endTime = Date.now();
      this.logger.info(
        `Judge ${parsedResponse.approved ? "approved" : "rejected"} grading. ` +
          `Mathematical: ${JSON.stringify(
            parsedResponse.mathematicallyCorrect,
          )}, ` +
          `Aligned: ${JSON.stringify(parsedResponse.feedbackAligned)}, ` +
          `Rubric: ${JSON.stringify(parsedResponse.rubricAdherence)}, ` +
          `Fairness: ${JSON.stringify(parsedResponse.fairnessScore)}/10, ` +
          `Time: ${endTime - startTime}ms`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `Error in judge validation: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );

      return {
        approved: false,
        feedback:
          "Judge validation temporarily unavailable. Please review grading manually.",
        issues: ["Judge service error - manual review required"],
      };
    }
  }

  private validateInput(input: GradingJudgeInput): void {
    if (!input.question) {
      throw new Error("Question is required for judge validation");
    }

    if (!input.learnerResponse) {
      throw new Error("Learner response is required for judge validation");
    }

    if (
      typeof input.proposedGrading.points !== "number" ||
      input.proposedGrading.points < 0
    ) {
      throw new Error("Invalid proposed points");
    }

    if (
      typeof input.proposedGrading.maxPoints !== "number" ||
      input.proposedGrading.maxPoints <= 0
    ) {
      throw new Error("Invalid max points");
    }
  }

  private buildJudgeResult(
    parsedResponse: ParsedJudgeResponse,
    input: GradingJudgeInput,
  ): GradingJudgeResult {
    // REMOVED: Mathematical validation - Judge LLM should not do arithmetic
    // The Judge LLM should only focus on qualitative aspects like fairness and rubric adherence
    this.logger.info(
      `Judge focusing on qualitative assessment only. Ignoring mathematical calculations.`,
    );

    const result: GradingJudgeResult = {
      approved: parsedResponse.approved,
      feedback: parsedResponse.feedback || "No feedback provided",
      issues: parsedResponse.issues || [],
    };

    if (!parsedResponse.approved) {
      result.corrections = {};

      // Focus only on qualitative issues, not arithmetic
      if (parsedResponse.fairnessScore < 5) {
        // Only reject for severe unfairness
        result.issues = [
          `Grading appears unfair (fairness score: ${parsedResponse.fairnessScore}/10)`,
        ];
      } else if (!parsedResponse.rubricAdherence) {
        // Check if it's a real rubric error or just subjective disagreement
        const rubricScores = input.proposedGrading.rubricScores || [];
        const hasInvalidPoints = rubricScores.some((score) => {
          // This would need actual validation against criteria
          // For now, just check if points are reasonable
          return (
            score.pointsAwarded < 0 || score.pointsAwarded > score.maxPoints
          );
        });

        if (hasInvalidPoints) {
          result.issues = ["Invalid rubric point values used"];
        } else {
          // If rubric values are technically valid, don't reject for subjective disagreement
          this.logger.info(
            "Judge disagrees with rubric scoring but values are valid. Approving.",
          );
          return {
            approved: true,
            feedback:
              "Grading is technically correct despite subjective concerns",
            issues: [],
          };
        }
      }

      // Don't add corrections for subjective disagreements
      if (
        parsedResponse.suggestedFeedbackChanges &&
        parsedResponse.fairnessScore < 5
      ) {
        result.corrections.feedback = parsedResponse.suggestedFeedbackChanges;
      }

      if (
        parsedResponse.correctedRubricScores &&
        Array.isArray(parsedResponse.correctedRubricScores) &&
        parsedResponse.correctedRubricScores.length > 0
      ) {
        result.corrections.rubricScores = parsedResponse.correctedRubricScores;
      }
    }

    return result;
  }

  private getOrCreateParser(): StructuredOutputParser<
    typeof ParsedJudgeResponseSchema
  > {
    const cacheKey = {};
    let parser = judgeParserCache.get(cacheKey);

    if (!parser) {
      parser = StructuredOutputParser.fromZodSchema(ParsedJudgeResponseSchema);
      judgeParserCache.set(cacheKey, parser);
    }

    return parser as StructuredOutputParser<typeof ParsedJudgeResponseSchema>;
  }

  private async processWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Operation timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });

    return Promise.race([promise, timeoutPromise]);
  }

  private loadJudgeTemplate(): string {
    return `Validate grading for QUALITATIVE FAIRNESS & RUBRIC ADHERENCE only. DO NOT do mathematical calculations or re-grade.

GRADING TO VALIDATE:
Points: {proposed_points} | Max: {max_points}
Scores: {proposed_rubric_scores}

CRITERIA: {scoring_criteria}

VALIDATION (NO ARITHMETIC):
1. Fairness: Is the grading reasonable and fair given the learner response?
2. Rubric adherence: Are the rubric scores appropriate for the response quality?
3. Extremely unfair (fairness < 5/10)? If YES → REJECT

✅ APPROVE: Valid rubric application + fairness ≥5
❌ REJECT: Invalid rubric application OR fairness <5

IMPORTANT: Do NOT validate mathematical accuracy. Focus only on qualitative assessment.

Context: {question} | {learner_response}

{format_instructions}`;
  }
}
