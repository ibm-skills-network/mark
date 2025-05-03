// src/llm/features/grading/services/url-grading.service.ts
import { Injectable, Inject, HttpException, HttpStatus } from "@nestjs/common";
import { AIUsageType } from "@prisma/client";
import { PromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "langchain/output_parsers";
import { z } from "zod";

import {
  PROMPT_PROCESSOR,
  MODERATION_SERVICE,
  RESPONSE_TYPE_SPECIFIC_INSTRUCTIONS,
} from "../../../llm.constants";
import { IPromptProcessor } from "../../../core/interfaces/prompt-processor.interface";
import { IModerationService } from "../../../core/interfaces/moderation.interface";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { UrlBasedQuestionEvaluateModel } from "src/api/llm/model/url.based.question.evaluate.model";
import { UrlBasedQuestionResponseModel } from "src/api/llm/model/url.based.question.response.model";
import { Logger } from "winston";
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

    // Validate the learner's response
    const validateLearnerResponse =
      await this.moderationService.validateContent(urlProvided);
    if (!validateLearnerResponse) {
      throw new HttpException(
        "Learner response validation failed",
        HttpStatus.BAD_REQUEST,
      );
    }

    // Define output schema
    const parser = StructuredOutputParser.fromZodSchema(
      z.object({
        points: z.number().describe("Points awarded based on the criteria"),
        feedback: z
          .string()
          .describe(
            "Feedback for the learner based on their response to the criteria",
          ),
      }),
    );

    const formatInstructions = parser.getFormatInstructions();

    // Add response-specific instructions
    const responseSpecificInstruction: string =
      (RESPONSE_TYPE_SPECIFIC_INSTRUCTIONS[responseType] as string) ?? "";

    // Create the prompt
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

    // Process the prompt through the LLM
    const response = await this.promptProcessor.processPrompt(
      prompt,
      assignmentId,
      AIUsageType.ASSIGNMENT_GRADING,
    );

    try {
      // Parse the response into the expected output format
      const urlBasedQuestionResponseModel = await parser.parse(response);
      return urlBasedQuestionResponseModel as UrlBasedQuestionResponseModel;
    } catch (error) {
      this.logger.error(
        `Error parsing LLM response: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      throw new HttpException(
        "Failed to parse grading response",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
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
    4. Provide detailed, constructive feedback that explains your evaluation.
    5. Suggest improvements for any issues identified.
    
    LANGUAGE: {language}
    
    Respond with a JSON object containing the points awarded and feedback according to the following format:
    {format_instructions}
    `;
  }
}
