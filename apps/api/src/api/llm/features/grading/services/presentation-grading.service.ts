/* eslint-disable unicorn/no-null */
// src/llm/features/grading/services/presentation-grading.service.ts
import { PromptTemplate } from "@langchain/core/prompts";
import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { AIUsageType } from "@prisma/client";
import { StructuredOutputParser } from "langchain/output_parsers";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { PresentationQuestionEvaluateModel } from "src/api/llm/model/presentation.question.evaluate.model";
import { PresentationQuestionResponseModel } from "src/api/llm/model/presentation.question.response.model";
import { Logger } from "winston";
import { z } from "zod";
import { LearnerLiveRecordingFeedback } from "../../../../assignment/attempt/dto/assignment-attempt/types";
import { IModerationService } from "../../../core/interfaces/moderation.interface";
import { IPromptProcessor } from "../../../core/interfaces/prompt-processor.interface";
import { MODERATION_SERVICE, PROMPT_PROCESSOR } from "../../../llm.constants";
import { IPresentationGradingService } from "../interfaces/presentation-grading.interface";

@Injectable()
export class PresentationGradingService implements IPresentationGradingService {
  private readonly logger: Logger;

  constructor(
    @Inject(PROMPT_PROCESSOR)
    private readonly promptProcessor: IPromptProcessor,
    @Inject(MODERATION_SERVICE)
    private readonly moderationService: IModerationService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({
      context: PresentationGradingService.name,
    });
  }

  /**
   * Grade a presentation question response
   */
  async gradePresentationQuestion(
    presentationQuestionEvaluateModel: PresentationQuestionEvaluateModel,
    assignmentId: number,
  ): Promise<PresentationQuestionResponseModel> {
    const {
      question,
      learnerResponse,
      totalPoints,
      scoringCriteriaType,
      scoringCriteria,
      previousQuestionsAnswersContext,
      assignmentInstrctions,
      responseType,
    } = presentationQuestionEvaluateModel;

    // Basic guard: ensure question text is present
    if (!question) {
      throw new HttpException("Missing question data", HttpStatus.BAD_REQUEST);
    }

    // If your guard rails only apply to the transcript, ensure it's at least a string
    const hasTranscript =
      learnerResponse?.transcript &&
      typeof learnerResponse.transcript === "string";
    const validateLearnerResponse = hasTranscript
      ? await this.moderationService.validateContent(learnerResponse.transcript)
      : true; // If no transcript is given, you can skip or apply different rules

    if (!validateLearnerResponse) {
      throw new HttpException(
        "Learner response validation failed",
        HttpStatus.BAD_REQUEST,
      );
    }

    // Optional fields: Provide fallbacks if missing
    const safeSpeechReport =
      learnerResponse?.speechReport ?? "No speech analysis provided.";
    const safeContentReport =
      learnerResponse?.contentReport ?? "No content analysis provided.";
    const safeBodyLangScore =
      learnerResponse?.bodyLanguageScore == null
        ? "N/A"
        : learnerResponse.bodyLanguageScore.toString();
    const safeBodyLangExplanation =
      learnerResponse?.bodyLanguageExplanation ?? "Not provided.";

    // Define output schema with AEEG structure
    const parser = StructuredOutputParser.fromZodSchema(
      z.object({
        points: z.number().describe("Points awarded based on the criteria"),
        feedback: z
          .string()
          .describe(
            "Comprehensive feedback following the AEEG approach (Analyze, Evaluate, Explain, Guide)",
          ),
        analysis: z
          .string()
          .describe(
            "Detailed analysis of what is observed in the presentation data",
          ),
        evaluation: z
          .string()
          .describe(
            "Evaluation of how well the presentation meets each assessment aspect",
          ),
        explanation: z
          .string()
          .describe(
            "Clear reasons for the grade based on specific observations",
          ),
        guidance: z
          .string()
          .describe(
            "Concrete suggestions for improvement in future presentations",
          ),
        rubricScores: z
          .array(
            z.object({
              rubricQuestion: z.string(),
              pointsAwarded: z.number(),
              maxPoints: z.number(),
              justification: z.string(),
            }),
          )
          .describe("Individual scores for each rubric criterion")
          .optional(),
      }),
    );

    const formatInstructions = parser.getFormatInstructions();

    // Build the prompt with partial variables, safely handling missing fields
    const prompt = new PromptTemplate({
      template: this.loadPresentationGradingTemplate(),
      inputVariables: [],
      partialVariables: {
        question: () => question, // The main question text
        assignment_instructions: () =>
          assignmentInstrctions ?? "No assignment instructions provided.",
        previous_questions_and_answers: () =>
          JSON.stringify(previousQuestionsAnswersContext ?? []),
        transcript: () =>
          learnerResponse?.transcript ?? "No transcript provided.",
        contentReport: () => safeContentReport,
        speechReport: () => safeSpeechReport,
        bodyLanguageScore: () => safeBodyLangScore,
        bodyLanguageExplanation: () => safeBodyLangExplanation,
        total_points: () =>
          totalPoints == null ? "0" : totalPoints.toString(),
        scoring_type: () => scoringCriteriaType ?? "N/A",
        scoring_criteria: () => JSON.stringify(scoringCriteria ?? {}),
        format_instructions: () => formatInstructions,
        grading_type: () => responseType ?? "N/A",
      },
    });

    // Process the prompt through the LLM
    const response = await this.promptProcessor.processPrompt(
      prompt,
      assignmentId,
      AIUsageType.ASSIGNMENT_GRADING,
    );

    try {
      // Parse the LLM output to get points & feedback
      const parsedResponse = await parser.parse(response);
      console.log("Parsed Response:", parsedResponse);

      // Combine the AEEG components into comprehensive feedback
      const aeegFeedback = `
**Analysis:**
${parsedResponse.analysis}

**Evaluation:**
${parsedResponse.evaluation}

**Explanation:**
${parsedResponse.explanation}

**Guidance:**
${parsedResponse.guidance}
`.trim();

      // Return the response with combined feedback
      return {
        points: parsedResponse.points,
        feedback: aeegFeedback,
      } as PresentationQuestionResponseModel;
    } catch (error) {
      this.logger.error(
        `Error parsing presentation grading response: ${
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
   * Generate feedback for a live recording
   */
  async getLiveRecordingFeedback(
    liveRecordingData: LearnerLiveRecordingFeedback,
    assignmentId: number,
  ): Promise<string> {
    // Define the parser with AEEG structure
    const parser = StructuredOutputParser.fromZodSchema(
      z.object({
        feedback: z.string().nonempty("Feedback cannot be empty"),
        analysis: z
          .string()
          .describe("Detailed analysis of the presentation elements"),
        evaluation: z
          .string()
          .describe("Evaluation of presentation effectiveness"),
        explanation: z
          .string()
          .describe("Clear explanation of strengths and areas for improvement"),
        guidance: z
          .string()
          .describe("Specific recommendations for improvement"),
      }),
    );

    const formatInstructions = parser.getFormatInstructions();

    // Safely handle optional fields using defaults when missing
    const safeSpeechReport =
      liveRecordingData.speechReport ?? "No speech analysis available.";
    const safeContentReport =
      liveRecordingData.contentReport ?? "No content analysis available.";
    const safeBodyLangScore =
      liveRecordingData.bodyLanguageScore == null
        ? "N/A"
        : String(liveRecordingData.bodyLanguageScore);
    const safeBodyLangExplanation =
      liveRecordingData.bodyLanguageExplanation ?? "Not provided.";

    const prompt = new PromptTemplate({
      template: this.loadLiveRecordingFeedbackTemplate(),
      inputVariables: [],
      partialVariables: {
        question_text: () => liveRecordingData.question.question,

        live_recording_transcript: () =>
          JSON.stringify(
            liveRecordingData.transcript ?? "No transcript provided.",
            null,
            2,
          ),

        live_recording_speechReport: () =>
          JSON.stringify(safeSpeechReport, null, 2),

        live_recording_contentReport: () =>
          JSON.stringify(safeContentReport, null, 2),

        live_recording_bodyLanguageScore: () => String(safeBodyLangScore),

        live_recording_bodyLanguageExplanation: () => safeBodyLangExplanation,

        format_instructions: () => formatInstructions,
      },
    });

    try {
      // Process the prompt through the LLM
      const response = await this.promptProcessor.processPrompt(
        prompt,
        assignmentId,
        AIUsageType.LIVE_RECORDING_FEEDBACK,
      );

      // Parse the response
      const parsedResponse = await parser.parse(response);

      // Combine AEEG components if returning structured feedback
      const aeegFeedback = `
**Analysis:**
${parsedResponse.analysis}

**Evaluation:**
${parsedResponse.evaluation}

**Explanation:**
${parsedResponse.explanation}

**Guidance:**
${parsedResponse.guidance}
`.trim();

      return parsedResponse.feedback || aeegFeedback;
    } catch (error) {
      this.logger.error(
        `Error generating live recording feedback: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      throw new HttpException(
        "Failed to generate live recording feedback",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Load the presentation grading template with AEEG approach
   */
  private loadPresentationGradingTemplate(): string {
    return `
    You are an expert educator evaluating a student's presentation or live recording using the AEEG (Analyze, Evaluate, Explain, Guide) approach.
    
    QUESTION:
    {question}
    
    ASSIGNMENT INSTRUCTIONS:
    {assignment_instructions}
    
    PREVIOUS QUESTIONS AND ANSWERS:
    {previous_questions_and_answers}
    
    PRESENTATION DATA:
    Transcript: {transcript}
    Content Report: {contentReport}
    Speech Report: {speechReport}
    Body Language Score: {bodyLanguageScore}
    Body Language Explanation: {bodyLanguageExplanation}
    
    SCORING INFORMATION:
    Total Points Available: {total_points}
    Scoring Type: {scoring_type}
    Scoring Criteria: {scoring_criteria}
    
    CRITICAL GRADING INSTRUCTIONS:
    You MUST grade according to the EXACT rubric provided in the scoring criteria. If the scoring type is "CRITERIA_BASED" with rubrics:
    1. Evaluate the presentation against EACH rubric question provided
    2. Award points based ONLY on the criteria descriptions provided for each rubric
    3. Do NOT use generic presentation criteria unless specifically mentioned in the rubric
    4. For each rubric, select the criterion that best matches the student's performance and award those exact points
    5. The total points awarded must equal the sum of points from all rubrics
    6. Use ALL available presentation data (transcript, speech report, body language) to evaluate each rubric
    
    GRADING APPROACH (AEEG):
    
    1. ANALYZE: Carefully examine the presentation data and describe what you observe
       - Review the transcript for content completeness and accuracy
       - Examine speech patterns, pacing, and vocal delivery from the speech report
       - Observe body language indicators and their impact on the presentation
       - Note the overall structure and flow of the presentation
       - Identify key points, examples, and arguments presented
       - Focus analysis on aspects relevant to the rubric criteria
    
    2. EVALUATE: For each rubric question in the scoring criteria:
       - Read the rubric question carefully
       - Use ALL presentation data (transcript, speech, body language) to assess performance
       - Compare the presentation against each criterion level
       - Select the criterion that best matches the student's performance
       - Award the exact points specified for that criterion
       - Do NOT average or adjust points - use the exact values provided
    
    3. EXPLAIN: Provide clear reasons for the grade based on specific observations from the presentation
       - For each rubric, explain why you selected that specific criterion level
       - Reference specific moments from the transcript
       - Include observations from speech and body language reports
       - Connect all observations directly to the rubric descriptions
       - Justify the total points as the sum of all rubric scores
    
    4. GUIDE: Offer concrete suggestions for improvement
       - Provide specific techniques to address weaknesses identified in each rubric
       - Suggest ways to improve speech patterns and vocal variety
       - Recommend body language adjustments for better engagement
       - Offer strategies for better structure and organization
       - Include actionable tips specific to the rubric criteria
    
    GRADING INSTRUCTIONS:
    - Be fair, consistent, and constructive in your evaluation
    - Use ALL available data (transcript, speech, body language) in your assessment
    - Balance honesty about weaknesses with recognition of strengths
    - Ensure feedback is specific to the presentation data provided
    - Use encouraging language while maintaining academic standards
    
    Respond with a JSON object containing:
    - Points awarded (sum of all rubric scores)
    - Comprehensive feedback incorporating all four AEEG components
    - Separate fields for each AEEG component
    - If scoring type is CRITERIA_BASED, include rubricScores array with score for each rubric
    
    Format your response according to:
    {format_instructions}
    `;
  }

  /**
   * Load the live recording feedback template with AEEG approach
   */
  private loadLiveRecordingFeedbackTemplate(): string {
    return `
    You are an expert educator evaluating a student's live recording or presentation using the AEEG (Analyze, Evaluate, Explain, Guide) approach.
    
    QUESTION:
    {question_text}
    
    LIVE RECORDING DATA:
    Transcript: {live_recording_transcript}
    Content Report: {live_recording_contentReport}
    Speech Report: {live_recording_speechReport}
    Body Language Score: {live_recording_bodyLanguageScore}
    Body Language Explanation: {live_recording_bodyLanguageExplanation}
    
    FEEDBACK APPROACH (AEEG):
    
    1. ANALYZE: Carefully examine the presentation data and describe what you observe
       - Study the transcript for main ideas and supporting details
       - Review speech characteristics (pace, tone, clarity, fluency)
       - Examine body language and its alignment with the message
       - Note engagement level and presentation confidence
       - Identify patterns in delivery and content organization
    
    2. EVALUATE: Assess the effectiveness of the presentation
       - Judge content relevance and depth based on the question
       - Evaluate speech quality and audience engagement potential
       - Assess non-verbal communication effectiveness
       - Consider overall coherence and persuasiveness
       - Measure achievement of presentation objectives
    
    3. EXPLAIN: Provide clear explanations of your assessment
       - Reference specific examples from the transcript
       - Connect observations from speech and body language reports
       - Highlight what worked well with evidence
       - Clearly explain any shortcomings observed
       - Provide context for your evaluation
    
    4. GUIDE: Offer concrete suggestions for improvement
       - Recommend specific content enhancements
       - Suggest vocal technique improvements
       - Provide body language tips for better impact
       - Offer strategies for better organization
       - Include practical exercises for skill development
    
    FEEDBACK INSTRUCTIONS:
    - Structure your feedback following the AEEG format
    - Be specific, actionable, and supportive
    - Balance constructive criticism with positive reinforcement
    - Focus on growth and improvement opportunities
    - Ensure all recommendations are practical and achievable
    
    Respond with a JSON object containing:
    - Comprehensive feedback incorporating all AEEG components
    - Separate fields for each AEEG component (analysis, evaluation, explanation, guidance)
    
    Format your response according to:
    {format_instructions}
    `;
  }
}
