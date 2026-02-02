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
  subjectiveLanguageDetected: z.boolean(),
  evidencePresent: z.boolean(),
  strictRubricCompliance: z.boolean(),
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
  private readonly maxJudgeTimeout = 120_000;

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
    const issues: string[] = parsedResponse.issues || [];

    if (parsedResponse.subjectiveLanguageDetected) {
      issues.push(
        "Excessive subjective/emotional language detected in feedback.",
      );
    }

    if (!parsedResponse.evidencePresent) {
      issues.push("Feedback does not reference the learner's response.");
    }

    if (!parsedResponse.strictRubricCompliance) {
      issues.push("Points awarded significantly deviate from rubric values.");
    }

    const rubricScores = input.proposedGrading.rubricScores || [];
    const hasInvalidPoints = rubricScores.some((score) => {
      return score.pointsAwarded < 0 || score.pointsAwarded > score.maxPoints;
    });

    if (hasInvalidPoints) {
      issues.push("Points awarded exceed maximum for one or more criteria");
    }

    const seriousViolations = hasInvalidPoints;
    const qualitativeConcerns = parsedResponse.fairnessScore < 5;

    const approved = !seriousViolations && !qualitativeConcerns;

    this.logger.info(
      `Judge validation: Serious violations: ${String(seriousViolations)}, ` +
        `Fairness score: ${parsedResponse.fairnessScore}/10, ` +
        `Approved: ${String(approved)}`,
    );

    const result: GradingJudgeResult = {
      approved,
      feedback: parsedResponse.feedback || "No feedback provided",
      issues,
    };

    if (!approved) {
      result.corrections = {};

      if (parsedResponse.suggestedFeedbackChanges) {
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
    return `You are a grading validation engine for quality assurance.

GRADING TO VALIDATE:
Points: {proposed_points} / {max_points}
Rubric Scores: {proposed_rubric_scores}
Feedback: {proposed_feedback}

RUBRIC CRITERIA: {scoring_criteria}

LEARNER RESPONSE: {learner_response}

QUESTION: {question}

VALIDATION CHECKS:

1. **Subjective Language Check** (subjectiveLanguageDetected):
   - Only flag if feedback contains excessive praise/criticism: "excellent work!", "terrible job!", "amazing!", "awful"
   - Descriptive words like "accurate", "complete", "missing", "incorrect" are ACCEPTABLE
   - Set to true ONLY if genuinely promotional/emotional language is used
   - Also flag if feedback states criterion requirements: "Criterion requires...", "The rubric expects...", "According to the criterion..."
   - Feedback should be learner-focused (what they did/didn't include), not criterion-focused

2. **Evidence Check** (evidencePresent):
   - Does feedback reference specific parts of the learner's response?
   - It doesn't need to be direct quotes - paraphrasing is fine
   - Feedback should focus on what the learner DID or DID NOT include, not what the criterion asks for
   - Set to false ONLY if feedback is completely generic with no connection to the response

3. **Rubric Compliance** (strictRubricCompliance):
   - Do the points awarded match values from the rubric criteria?
   - Minor point adjustments (±1) are ACCEPTABLE if justified
   - Set to false ONLY if points are wildly off from rubric values

4. **Fairness Score** (fairnessScore: 0-10):
   - 0-4: Clearly unfair, biased, or inconsistent
   - 5-7: Reasonable and justified
   - 8-10: Perfectly aligned with rubric

5. **Rubric Adherence** (rubricAdherence):
   - Are the rubric criteria being applied?
   - Set to false ONLY if rubric is completely ignored

6. **Feedback Aligned** (feedbackAligned):
   - Does feedback generally match the score?
   - Set to false ONLY if major misalignment (e.g., positive feedback but low score)

APPROVAL CRITERIA:
- ✅ APPROVE if: fairnessScore ≥ 5 AND no major violations
- ❌ REJECT if: fairnessScore < 5 OR serious rubric violations OR completely missing evidence

Be LENIENT - only reject if there are genuinely serious problems with the grading.

{format_instructions}`;
  }
}
