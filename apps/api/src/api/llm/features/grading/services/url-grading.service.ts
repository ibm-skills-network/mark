import { PromptTemplate } from "@langchain/core/prompts";
import { Inject, Injectable } from "@nestjs/common";
import { AIUsageType } from "@prisma/client";
import { StructuredOutputParser } from "@langchain/classic/output_parsers";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { ScoringDto } from "src/api/assignment/dto/update.questions.request.dto";
import { UrlBasedQuestionEvaluateModel } from "src/api/llm/model/url.based.question.evaluate.model";
import { UrlBasedQuestionResponseModel } from "src/api/llm/model/url.based.question.response.model";
import { Logger } from "winston";
import { z } from "zod";
import { EvidenceChunkingService } from "./evidence-chunking.service";
import { CriterionEvidencePipelineService } from "./criterion-evidence-pipeline.service";
import { RubricCriterion } from "../types/criterion-evidence.types";
import { IModerationService } from "../../../core/interfaces/moderation.interface";
import { IPromptProcessor } from "../../../core/interfaces/prompt-processor.interface";
import {
  MODERATION_SERVICE,
  PROMPT_PROCESSOR,
  RESPONSE_TYPE_SPECIFIC_INSTRUCTIONS,
} from "../../../llm.constants";
import { MODERATION_BLOCK_FEEDBACK } from "../constants";
import { IUrlGradingService } from "../interfaces/url-grading.interface";

@Injectable()
export class UrlGradingService implements IUrlGradingService {
  private readonly logger: Logger;

  constructor(
    @Inject(PROMPT_PROCESSOR)
    private readonly promptProcessor: IPromptProcessor,
    @Inject(MODERATION_SERVICE)
    private readonly moderationService: IModerationService,
    private readonly chunkingService: EvidenceChunkingService,
    private readonly evidencePipeline: CriterionEvidencePipelineService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: UrlGradingService.name });
  }

  /**
   * Grade a URL-based question response
   */
  async gradeUrlBasedQuestion(
    urlBasedQuestionEvaluateModel: UrlBasedQuestionEvaluateModel,
    assignmentId: number,
    language?: string,
  ): Promise<UrlBasedQuestionResponseModel> {
    const {
      question,
      urlProvided,
      isUrlFunctional,
      urlBody,
      totalPoints,
      scoringCriteriaType,
      scoringCriteria,
      previousQuestionsAnswersContext,
      assignmentInstrctions,
      responseType,
      safetyIdentifier,
    } = urlBasedQuestionEvaluateModel;

    const moderationVerdict =
      await this.moderationService.assessContent(urlProvided);
    if (moderationVerdict.action === "block_severe") {
      this.logger.warn("grading.moderation.blocked_severe", {
        assignmentId,
        categories: moderationVerdict.severeCategories,
      });
      return {
        points: 0,
        feedback: MODERATION_BLOCK_FEEDBACK,
        gradingRationale: MODERATION_BLOCK_FEEDBACK,
      } as UrlBasedQuestionResponseModel;
    }
    if (moderationVerdict.action === "allow_with_log") {
      this.logger.warn("grading.moderation.flagged", {
        assignmentId,
        categories: moderationVerdict.flaggedCategories,
      });
    }

    const rubricCriteria = this.convertToRubricCriteria(
      scoringCriteria as ScoringDto,
    );

    if (scoringCriteriaType === "CRITERIA_BASED" && rubricCriteria.length > 0) {
      const chunks = this.chunkingService.extractFromUrl(
        urlProvided || "unknown-url",
        urlBody?.toString() || "",
      );

      const pipelineResult = await this.evidencePipeline.gradeWithEvidence({
        question,
        criteria: rubricCriteria,
        chunks,
        assignmentId,
        language,
        maxConcurrency: 6,
        maxRetries: 3,
        modelOverrides: {
          retrievalModel: "gpt-5-nano",
          gradingModel: "gpt-5-mini",
          judgeModel: "gpt-5-mini",
        },
      });

      return this.buildUrlResponseFromPipeline(pipelineResult, totalPoints);
    }

    const parser = StructuredOutputParser.fromZodSchema(
      z.object({
        points: z.number().describe("Points awarded based on the criteria"),
        feedback: z
          .string()
          .describe(
            "Feedback for the learner based on their response to the criteria, the feedback should include detailed explanation why you chose to provide the points you did",
          ),
      }),
    );

    const formatInstructions = parser.getFormatInstructions();

    const responseSpecificInstruction: string =
      RESPONSE_TYPE_SPECIFIC_INSTRUCTIONS[responseType] ?? "";

    const prompt = new PromptTemplate({
      template: this.loadUrlGradingTemplate(),
      inputVariables: [],
      partialVariables: {
        question: () => question,
        assignment_instructions: () => assignmentInstrctions,
        responseSpecificInstruction: () => responseSpecificInstruction,
        previous_questions_and_answers: () =>
          JSON.stringify(previousQuestionsAnswersContext),
        url_provided: () => urlProvided ?? "",
        url_body: () => urlBody.toString(),
        is_url_functional: () =>
          isUrlFunctional ? "functional" : "not functional",
        total_points: () => totalPoints.toString(),
        scoring_type: () => scoringCriteriaType,
        scoring_criteria: () => JSON.stringify(scoringCriteria),
        format_instructions: () => formatInstructions,
        grading_type: () => responseType,
        language: () => language ?? "en",
      },
    });

    let response: string;
    try {
      response = await this.processPromptWithRetry(
        prompt,
        assignmentId,
        totalPoints,
        safetyIdentifier,
      );
    } catch (retryError) {
      this.logger.error(
        `All URL grading LLM retry attempts failed: ${
          retryError instanceof Error ? retryError.message : String(retryError)
        }`,
      );
      return this.createFallbackUrlResponse(
        totalPoints,
        "All LLM models failed - using fallback grading",
      );
    }

    try {
      const urlBasedQuestionResponseModel = await parser.parse(response);
      return urlBasedQuestionResponseModel as UrlBasedQuestionResponseModel;
    } catch (error) {
      this.logger.error(
        `Error parsing LLM response: ${
          error instanceof Error ? error.message : "Unknown error"
        }. Response: "${response?.slice(0, 200)}..."`,
      );

      return this.createFallbackUrlResponse(
        totalPoints,
        "Failed to parse LLM response",
      );
    }
  }

  /**
   * Create a fallback response when URL grading LLM fails
   */
  private createFallbackUrlResponse(
    totalPoints: number,
    reason: string,
  ): UrlBasedQuestionResponseModel {
    const fallbackPoints = totalPoints > 0 ? Math.floor(totalPoints * 0.5) : 0;

    return {
      points: fallbackPoints,
      feedback: `Automated grading temporarily unavailable. ${reason}. Partial credit (${fallbackPoints}/${totalPoints}) awarded pending manual review.`,
      gradingRationale: `URL content could not be automatically evaluated due to technical issues. This submission requires manual review.`,
    } as UrlBasedQuestionResponseModel;
  }

  /**
   * Load URL grading template
   */
  private loadUrlGradingTemplate(): string {
    return `
    You are an expert educator evaluating a student's URL submission.
    
    QUESTION:
    {question}
    
    ASSIGNMENT INSTRUCTIONS:
    {assignment_instructions}
    
    PREVIOUS QUESTIONS AND ANSWERS:
    {previous_questions_and_answers}
    
    RESPONSE TYPE SPECIFIC INSTRUCTIONS:
    {responseSpecificInstruction}
    
    URL SUBMISSION:
    URL Provided: {url_provided}
    URL Status: {is_url_functional}
    
    CONTENT FROM URL (if available):
    {url_body}
    
    SCORING INFORMATION:
    Total Points Available: {total_points}
    Scoring Type: {scoring_type}
    Scoring Criteria: {scoring_criteria}
    
    GRADING INSTRUCTIONS:
    1. Carefully evaluate the URL submission against the scoring criteria.
    2. Consider the URL's relevance, functionality, and content quality.
    3. Award points based on how well the submission meets the criteria.
    4. Provide detailed feedback that explains your evaluation and why you awarded the specific points.
    5. Include specific examples from the URL content that influenced your grading.
    6. Suggest improvements for any issues identified.

    FEEDBACK REQUIREMENTS:
    - Focus on what the learner DID or DID NOT include in their URL submission
    - If criteria are fully met: Point out what specific content was correctly provided at the URL
    - If criteria are partially met: State what was included AND what specific elements are missing
    - If criteria are NOT met: Explain what specific content or functionality is absent
    - Reference specific elements from the URL content (e.g., "The submitted page includes X", "The URL lacks Y")
    - Frame improvement suggestions as actionable guidance: "The submission should include..." or "Consider adding..."
    - Do NOT state criterion requirements or start with "Criterion requires..."
    - Focus on the submission itself, not what the rubric asks for
    - NO subjective adjectives, NO encouragement, NO praise - be specific and objective
    
    LANGUAGE: {language}
    
    Respond with a JSON object containing the points awarded and feedback according to the following format:
    {format_instructions}
    `;
  }

  /**
   * Process prompt with retry mechanism and fallback model for URL grading
   */
  private async processPromptWithRetry(
    prompt: PromptTemplate,
    assignmentId: number,
    _totalPoints: number,
    safetyIdentifier?: string,
  ): Promise<string> {
    void _totalPoints;
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.debug(`URL grading LLM attempt ${attempt}/${maxRetries}`);

        const response = await this.promptProcessor.processPromptForFeature(
          prompt,
          assignmentId,
          AIUsageType.ASSIGNMENT_GRADING,
          "url_grading",
          undefined,
          { safetyIdentifier },
        );

        if (this.isValidLLMResponse(response)) {
          if (attempt > 1) {
            this.logger.info(
              `URL grading LLM succeeded on attempt ${attempt}/${maxRetries}`,
            );
          }
          return response;
        }

        this.logger.warn(
          `URL grading LLM returned invalid response on attempt ${attempt}/${maxRetries}: "${response?.slice(
            0,
            100,
          )}..."`,
        );
        lastError = new Error(
          `Invalid LLM response: ${response?.slice(0, 100)}`,
        );
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(
          `URL grading LLM attempt ${attempt}/${maxRetries} failed: ${lastError.message}`,
        );
      }

      if (attempt < maxRetries) {
        await this.delay(Math.pow(2, attempt - 1) * 1000);
      }
    }

    try {
      this.logger.warn(
        `URL grading primary model failed after ${maxRetries} attempts, trying fallback approach`,
      );

      throw lastError || new Error("All URL grading LLM attempts failed");
    } catch (fallbackError) {
      this.logger.error(
        `URL grading fallback also failed: ${
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError)
        }`,
      );
      throw lastError || new Error("All URL grading LLM attempts failed");
    }
  }

  /**
   * Check if LLM response is valid
   */
  private isValidLLMResponse(response: string): boolean {
    return !!(response && response.trim() && response.length >= 10);
  }

  /**
   * Delay utility for retry backoff
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

  private buildUrlResponseFromPipeline(
    pipelineResult: {
      grades: Array<{
        rubricQuestion: string;
        pointsAwarded: number;
        maxPoints: number;
        rationale: string;
        citations: string[];
      }>;
      summary: { totalPoints: number; maxPoints: number };
      audit: unknown;
    },
    maxPoints: number,
  ): UrlBasedQuestionResponseModel {
    const feedbackLines = pipelineResult.grades.map(
      (grade) =>
        `**${grade.rubricQuestion}** (${grade.pointsAwarded}/${grade.maxPoints})\n${grade.rationale}`,
    );
    const feedback = feedbackLines.join("\n\n");

    return {
      points: Math.min(pipelineResult.summary.totalPoints, maxPoints),
      feedback,
      gradingRationale: feedback,
      metadata: pipelineResult.audit
        ? {
            gradingAudit: pipelineResult.audit,
          }
        : undefined,
    } as UrlBasedQuestionResponseModel;
  }
}
