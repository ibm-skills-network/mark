import { PromptTemplate } from "@langchain/core/prompts";
import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { AIUsageType } from "@prisma/client";
import { StructuredOutputParser } from "langchain/output_parsers";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { UrlBasedQuestionEvaluateModel } from "src/api/llm/model/url.based.question.evaluate.model";
import { UrlBasedQuestionResponseModel } from "src/api/llm/model/url.based.question.response.model";
import { Logger } from "winston";
import { z } from "zod";
import { IModerationService } from "../../../core/interfaces/moderation.interface";
import { IPromptProcessor } from "../../../core/interfaces/prompt-processor.interface";
import {
  MODERATION_SERVICE,
  PROMPT_PROCESSOR,
  RESPONSE_TYPE_SPECIFIC_INSTRUCTIONS,
} from "../../../llm.constants";
import { IUrlGradingService } from "../interfaces/url-grading.interface";

@Injectable()
export class UrlGradingService implements IUrlGradingService {
  private readonly logger: Logger;

  constructor(
    @Inject(PROMPT_PROCESSOR)
    private readonly promptProcessor: IPromptProcessor,
    @Inject(MODERATION_SERVICE)
    private readonly moderationService: IModerationService,
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
    } = urlBasedQuestionEvaluateModel;

    const validateLearnerResponse =
      await this.moderationService.validateContent(urlProvided);
    if (!validateLearnerResponse) {
      throw new HttpException(
        "Learner response validation failed",
        HttpStatus.BAD_REQUEST,
      );
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

      // Return a fallback response instead of throwing
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

    // Create object that matches the UrlBasedQuestionResponseModel structure
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
  ): Promise<string> {
    const maxRetries = 3;
    let lastError: Error | null = null;

    // Try with default model (up to 3 attempts)
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.debug(`URL grading LLM attempt ${attempt}/${maxRetries}`);

        const response = await this.promptProcessor.processPromptForFeature(
          prompt,
          assignmentId,
          AIUsageType.ASSIGNMENT_GRADING,
          "url_grading",
        );

        // Check if response is valid
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

      // Wait before retry (exponential backoff)
      if (attempt < maxRetries) {
        await this.delay(Math.pow(2, attempt - 1) * 1000); // 1s, 2s, 4s
      }
    }

    // Try with explicit fallback model using prompt processor's fallback mechanism
    try {
      this.logger.warn(
        `URL grading primary model failed after ${maxRetries} attempts, trying fallback approach`,
      );

      // Since this service doesn't have direct model selection, we'll throw to let the strategy handle fallback
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
}
