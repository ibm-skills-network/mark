// src/llm/features/grading/services/text-grading.service.ts
import { PromptTemplate } from "@langchain/core/prompts";
import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { AIUsageType } from "@prisma/client";
import { StructuredOutputParser } from "langchain/output_parsers";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { TextBasedQuestionEvaluateModel } from "src/api/llm/model/text.based.question.evaluate.model";
import { TextBasedQuestionResponseModel } from "src/api/llm/model/text.based.question.response.model";
import { Logger } from "winston";
import { z } from "zod";

// Define types to avoid deep instantiation issues
type RubricScore = {
  rubricQuestion: string;
  pointsAwarded: number;
  maxPoints: number;
  justification: string;
};

type GradingOutput = {
  points: number;
  feedback: string;
  analysis: string;
  evaluation: string;
  explanation: string;
  guidance: string;
  rubricScores?: RubricScore[];
};
import { IModerationService } from "../../../core/interfaces/moderation.interface";
import { IPromptProcessor } from "../../../core/interfaces/prompt-processor.interface";
import {
  MODERATION_SERVICE,
  PROMPT_PROCESSOR,
  RESPONSE_TYPE_SPECIFIC_INSTRUCTIONS,
} from "../../../llm.constants";
import { ITextGradingService } from "../interfaces/text-grading.interface";

@Injectable()
export class TextGradingService implements ITextGradingService {
  private readonly logger: Logger;

  constructor(
    @Inject(PROMPT_PROCESSOR)
    private readonly promptProcessor: IPromptProcessor,
    @Inject(MODERATION_SERVICE)
    private readonly moderationService: IModerationService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: TextGradingService.name });
  }

  /**
   * Grade a text-based question response
   */
  async gradeTextBasedQuestion(
    textBasedQuestionEvaluateModel: TextBasedQuestionEvaluateModel,
    assignmentId: number,
    language?: string,
  ): Promise<TextBasedQuestionResponseModel> {
    const {
      question,
      learnerResponse,
      totalPoints,
      scoringCriteriaType,
      scoringCriteria,
      previousQuestionsAnswersContext,
      assignmentInstrctions,
      responseType,
    } = textBasedQuestionEvaluateModel;

    // Validate the learner's response
    const validateLearnerResponse =
      await this.moderationService.validateContent(learnerResponse);
    if (!validateLearnerResponse) {
      throw new HttpException(
        "Learner response validation failed",
        HttpStatus.BAD_REQUEST,
      );
    }

    // Use simple Zod schema to avoid deep instantiation
    const parser = StructuredOutputParser.fromZodSchema(
      z.object({
        points: z.number(),
        feedback: z.string(),
        analysis: z.string(),
        evaluation: z.string(),
        explanation: z.string(),
        guidance: z.string(),
        rubricScores: z
          .array(
            z.object({
              rubricQuestion: z.string(),
              pointsAwarded: z.number(),
              maxPoints: z.number(),
              justification: z.string(),
            }),
          )
          .optional(),
      }),
    );

    const formatInstructions = parser.getFormatInstructions();

    // Add response-specific instructions based on the type
    const responseSpecificInstruction =
      (RESPONSE_TYPE_SPECIFIC_INSTRUCTIONS[responseType] as
        | string
        | undefined) ?? "";

    // Load the grading template
    const template = await this.loadTextGradingTemplate();

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
      const parsedResponse = (await parser.parse(response)) as GradingOutput;
      console.log("Parsed grading response:", parsedResponse);

      // Format rubric scores if available
      let rubricDetails = "";
      if (
        parsedResponse.rubricScores &&
        parsedResponse.rubricScores.length > 0
      ) {
        rubricDetails = "\n\n**Rubric Scoring:**\n";
        for (const score of parsedResponse.rubricScores) {
          rubricDetails += `${score.pointsAwarded}/${score.maxPoints} points\n`;
          rubricDetails += `Justification: ${score.justification}\n\n`;
        }
      }

      // Combine the AEEG components into comprehensive feedback
      const aeegFeedback = `
**Analysis:**
${parsedResponse.analysis}

**Evaluation:**
${parsedResponse.evaluation}

**Explanation:**
${parsedResponse.explanation}

**Guidance:**
${parsedResponse.guidance}${rubricDetails}
`.trim();

      // Return the response with combined feedback
      return {
        points: parsedResponse.points,
        feedback: aeegFeedback,
      } as TextBasedQuestionResponseModel;
    } catch (error) {
      this.logger.error(
        `Error parsing LLM response: ${
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
   * Load the text grading template with AEEG approach
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  private async loadTextGradingTemplate(): Promise<string> {
    return `
    You are an expert educator evaluating a student's response to a question using the AEEG (Analyze, Evaluate, Explain, Guide) approach.
    
    QUESTION:
    {question}
    
    ASSIGNMENT INSTRUCTIONS:
    {assignment_instructions}
    
    PREVIOUS QUESTIONS AND ANSWERS:
    {previous_questions_and_answers}
    
    STUDENT'S RESPONSE:
    {learner_response}
    
    RESPONSE TYPE SPECIFIC INSTRUCTIONS:
    {responseSpecificInstruction}
    
    SCORING INFORMATION:
    Total Points Available: {total_points}
    Scoring Type: {scoring_type}
    Scoring Criteria: {scoring_criteria}
    
    CRITICAL GRADING INSTRUCTIONS:
    You MUST grade according to the EXACT rubric provided in the scoring criteria. If the scoring type is "CRITERIA_BASED" with rubrics:
    1. Evaluate the response against EACH rubric question provided
    2. Award points based ONLY on the criteria descriptions provided for each rubric
    3. Do NOT use generic essay criteria like "creativity" or "depth of analysis" unless specifically mentioned in the rubric
    4. For each rubric, select the criterion that best matches the student's performance and award those exact points
    5. The total points awarded must equal the sum of points from all rubrics
    6. Include specific justification for why you selected each criterion level
    
    GRADING APPROACH (AEEG):
    
    1. ANALYZE: Carefully examine the student's response and describe what you observe
       - Identify key points made by the student
       - Note the structure and organization of their response
       - Recognize any evidence, examples, or reasoning provided
       - Observe the clarity and coherence of their communication
       - Focus on aspects relevant to the rubric criteria
    
    2. EVALUATE: For each rubric question in the scoring criteria:
       - Read the rubric question carefully
       - Compare the response against each criterion level
       - Select the criterion that best matches the student's performance
       - Award the exact points specified for that criterion
       - Do NOT average or adjust points - use the exact values provided
    
    3. EXPLAIN: Provide clear reasons for the grade based on specific observations
       - Justify why you selected each criterion level for each rubric
       - Reference specific parts of the student's response that led to your decisions
       - Connect your observations from the analysis to the evaluation outcomes
       - Make the grading rationale transparent and understandable
       - Ensure explanations align with the rubric criteria used
    
    4. GUIDE: Offer concrete suggestions for improvement
       - Provide specific, actionable feedback based on the rubric criteria
       - Suggest ways to reach higher criterion levels in each rubric
       - Recommend resources or strategies for improvement
       - Focus guidance on the specific skills assessed by the rubrics
    
    LANGUAGE: {language}
    
    Respond with a JSON object containing:
    - Points awarded (sum of all rubric scores)
    - Comprehensive feedback incorporating all four AEEG components
    - Separate fields for each AEEG component
    - If scoring type is CRITERIA_BASED, include rubricScores array with score for each rubric
    
    Format your response according to:
    {format_instructions}
    `;
  }
}
