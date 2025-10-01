import { PromptTemplate } from "@langchain/core/prompts";
import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { AIUsageType } from "@prisma/client";
import { StructuredOutputParser } from "langchain/output_parsers";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { VideoPresentationQuestionEvaluateModel } from "src/api/llm/model/video-presentation.question.evaluate.model";
import { VideoPresentationQuestionResponseModel } from "src/api/llm/model/video-presentation.question.response.model";
import { Logger } from "winston";
import { z } from "zod";
import { IModerationService } from "../../../core/interfaces/moderation.interface";
import { IPromptProcessor } from "../../../core/interfaces/prompt-processor.interface";
import { MODERATION_SERVICE, PROMPT_PROCESSOR } from "../../../llm.constants";
import { IVideoPresentationGradingService } from "../interfaces/video-grading.interface";

@Injectable()
export class VideoPresentationGradingService
  implements IVideoPresentationGradingService
{
  private readonly logger: Logger;

  constructor(
    @Inject(PROMPT_PROCESSOR)
    private readonly promptProcessor: IPromptProcessor,
    @Inject(MODERATION_SERVICE)
    private readonly moderationService: IModerationService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({
      context: VideoPresentationGradingService.name,
    });
  }

  /**
   * Grade a video presentation question response
   */
  async gradeVideoPresentationQuestion(
    videoPresentationQuestionEvaluateModel: VideoPresentationQuestionEvaluateModel,
    assignmentId: number,
  ): Promise<VideoPresentationQuestionResponseModel> {
    const {
      question,
      learnerResponse,
      totalPoints,
      scoringCriteriaType,
      scoringCriteria,
      previousQuestionsAnswersContext,
      assignmentInstrctions,
      responseType,
      videoPresentationConfig,
    } = videoPresentationQuestionEvaluateModel;

    const validateLearnerResponse =
      await this.moderationService.validateContent(learnerResponse.transcript);

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

    const prompt = new PromptTemplate({
      template: this.loadVideoPresentationGradingTemplate(),
      inputVariables: [],
      partialVariables: {
        question: () => question,
        assignment_instructions: () => assignmentInstrctions ?? "",
        previous_questions_and_answers: () =>
          JSON.stringify(previousQuestionsAnswersContext ?? []),
        transcript: () => learnerResponse.transcript,
        slidesData: () =>
          videoPresentationConfig?.evaluateSlidesQuality
            ? JSON.stringify(learnerResponse?.slidesData) ||
              "The learner did not provide any slides when it was required"
            : "Slides were not required, please ignore this field.",
        total_points: () => totalPoints.toString(),
        scoring_type: () => scoringCriteriaType,
        scoring_criteria: () => JSON.stringify(scoringCriteria),
        format_instructions: () => formatInstructions,
        grading_type: () => responseType,
        video_config: () => JSON.stringify(videoPresentationConfig ?? {}),
      },
    });

    const response = await this.promptProcessor.processPromptForFeature(
      prompt,
      assignmentId,
      AIUsageType.ASSIGNMENT_GRADING,
      "video_grading",
    );

    try {
      const videoPresentationQuestionResponseModel =
        await parser.parse(response);
      return videoPresentationQuestionResponseModel as VideoPresentationQuestionResponseModel;
    } catch (error) {
      this.logger.error(
        `Error parsing video presentation grading response: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      throw new HttpException(
        "Failed to parse grading response",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Load the video presentation grading template
   */
  private loadVideoPresentationGradingTemplate(): string {
    return `
    You are an expert educator evaluating a student's video presentation.
    
    QUESTION:
    {question}
    
    ASSIGNMENT INSTRUCTIONS:
    {assignment_instructions}
    
    PREVIOUS QUESTIONS AND ANSWERS:
    {previous_questions_and_answers}
    
    VIDEO PRESENTATION DATA:
    Transcript: {transcript}
    Slides Data: {slidesData}
    
    VIDEO PRESENTATION CONFIGURATION:
    {video_config}
    
    SCORING INFORMATION:
    Total Points Available: {total_points}
    Scoring Type: {scoring_type}
    Scoring Criteria: {scoring_criteria}
    
    GRADING INSTRUCTIONS:
    1. Carefully evaluate the video presentation against the scoring criteria.
    2. Consider the transcript content, slide quality (if applicable), and presentation structure.
    3. Award points based on how well the presentation meets the criteria.
    4. Provide detailed, constructive feedback that explains your evaluation.
    5. Include specific examples from the transcript or slides when relevant.
    6. Suggest improvements for future presentations.
    
    Respond with a JSON object containing the points awarded and feedback according to the following format:
    {format_instructions}
    `;
  }
}
