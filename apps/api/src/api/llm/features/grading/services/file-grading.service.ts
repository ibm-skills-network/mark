import { PromptTemplate } from "@langchain/core/prompts";
import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { AIUsageType, ResponseType } from "@prisma/client";
import { StructuredOutputParser } from "langchain/output_parsers";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { FileUploadQuestionEvaluateModel } from "src/api/llm/model/file.based.question.evaluate.model";
import { FileBasedQuestionResponseModel } from "src/api/llm/model/file.based.question.response.model";
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
import { MODERATION_SERVICE, PROMPT_PROCESSOR } from "../../../llm.constants";
import { IFileGradingService } from "../interfaces/file-grading.interface";

@Injectable()
export class FileGradingService implements IFileGradingService {
  private readonly logger: Logger;

  constructor(
    @Inject(PROMPT_PROCESSOR)
    private readonly promptProcessor: IPromptProcessor,
    @Inject(MODERATION_SERVICE)
    private readonly moderationService: IModerationService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: FileGradingService.name });
  }

  /**
   * Grade a file-based question response
   */
  async gradeFileBasedQuestion(
    fileBasedQuestionEvaluateModel: FileUploadQuestionEvaluateModel,
    assignmentId: number,
    language?: string,
  ): Promise<FileBasedQuestionResponseModel> {
    const {
      question,
      learnerResponse,
      totalPoints,
      scoringCriteriaType,
      scoringCriteria,
      responseType,
    } = fileBasedQuestionEvaluateModel;

    const validateLearnerResponse =
      await this.moderationService.validateContent(
        learnerResponse.map((item) => item.content).join(" "),
      );

    if (!validateLearnerResponse) {
      throw new HttpException(
        "Learner response validation failed",
        HttpStatus.BAD_REQUEST,
      );
    }

    let maxTotalPoints = totalPoints;
    const rubricMaxPoints: { rubricQuestion: string; maxPoints: number }[] = [];

    if (
      scoringCriteria &&
      typeof scoringCriteria === "object" &&
      scoringCriteria.rubrics
    ) {
      const rubrics = scoringCriteria.rubrics;
      if (Array.isArray(rubrics)) {
        let sum = 0;
        for (const rubric of rubrics) {
          if (Array.isArray(rubric.criteria)) {
            const maxCriteriaPoints = Math.max(
              ...rubric.criteria.map((criterion) => criterion.points || 0),
            );
            sum += maxCriteriaPoints;
            rubricMaxPoints.push({
              rubricQuestion: rubric.rubricQuestion || "Unnamed rubric",
              maxPoints: maxCriteriaPoints,
            });
          }
        }
        maxTotalPoints = sum;
      }
    }

    const selectedTemplate = this.getTemplateForFileType(responseType);

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

    const prompt = new PromptTemplate({
      template: selectedTemplate,
      inputVariables: [],
      partialVariables: {
        question: () => question,
        files: () =>
          JSON.stringify(
            learnerResponse.map((item) => ({
              filename: item.filename,
              content: item.content,
            })),
          ),
        total_points: () => maxTotalPoints.toString(),
        scoring_type: () => scoringCriteriaType,
        scoring_criteria: () => JSON.stringify(scoringCriteria),
        grading_type: () => responseType,
        language: () => language ?? "en",
        format_instructions: () => formatInstructions,
      },
    });

    const response = await this.promptProcessor.processPrompt(
      prompt,
      assignmentId,
      AIUsageType.ASSIGNMENT_GRADING,
    );

    try {
      const parsedResponse = (await parser.parse(response)) as GradingOutput;

      // Validate and format rubric scores if available
      let rubricDetails = "";
      let calculatedTotalPoints = 0;

      if (
        parsedResponse.rubricScores &&
        parsedResponse.rubricScores.length > 0
      ) {
        rubricDetails = "\n\n**Rubric Scoring:**\n";
        for (const score of parsedResponse.rubricScores) {
          rubricDetails += `${score.pointsAwarded}/${score.maxPoints} points\n`;
          rubricDetails += `Justification: ${score.justification}\n\n`;
          calculatedTotalPoints += score.pointsAwarded;
        }

        // If rubric scores are provided, ensure total points match sum of rubric scores
        if (
          scoringCriteriaType === "CRITERIA_BASED" &&
          parsedResponse.points !== calculatedTotalPoints
        ) {
          this.logger.warn(
            `LLM total points (${parsedResponse.points}) doesn't match sum of rubric scores (${calculatedTotalPoints}). Using rubric sum.`,
          );
          parsedResponse.points = calculatedTotalPoints;
        }
      }

      // Combine the AEEG components into comprehensive feedback
      const aeegFeedback = `
**Analysis:**
${parsedResponse.analysis}

**Evaluation:**
${parsedResponse.evaluation}${rubricDetails}

**Explanation:**
${parsedResponse.explanation}

**Guidance:**
${parsedResponse.guidance}
`.trim();

      const fileBasedQuestionResponseModel = {
        points: parsedResponse.points,
        feedback: aeegFeedback,
      };

      const parsedPoints = fileBasedQuestionResponseModel.points;
      if (parsedPoints > maxTotalPoints) {
        this.logger.warn(
          `LLM awarded ${parsedPoints} points, which exceeds maximum of ${maxTotalPoints}. Capping at maximum.`,
        );
        fileBasedQuestionResponseModel.points = maxTotalPoints;
      } else if (parsedPoints < 0) {
        this.logger.warn(
          `LLM awarded negative points (${parsedPoints}). Setting to 0.`,
        );
        fileBasedQuestionResponseModel.points = 0;
      }

      return fileBasedQuestionResponseModel as FileBasedQuestionResponseModel;
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

  private getTemplateForFileType(responseType: ResponseType): string {
    const fileTypeDescriptions: Record<ResponseType, string> = {
      CODE: "code submission with a focus on functionality, efficiency, style, and best practices",
      REPO: "repository submission with attention to project structure, documentation, testing, and maintainability",
      ESSAY:
        "essay submission evaluating thesis, argumentation, evidence, structure, and writing quality",
      REPORT:
        "report submission assessing data presentation, analysis, conclusions, format, and writing quality",
      PRESENTATION:
        "presentation submission focusing on content quality, slide design, organization, and visual communication",
      VIDEO:
        "video submission examining content, delivery, production quality, and communication effectiveness",
      AUDIO:
        "audio submission evaluating content, speech clarity, pacing, and engagement",
      SPREADSHEET:
        "spreadsheet submission analyzing data organization, formula usage, analysis, and presentation",
      LIVE_RECORDING:
        "live recording submission with focus on content, delivery, and presentation skills",
      IMAGES:
        "image-based submission evaluating visual content, relevance, and quality",
      OTHER:
        "document submission assessing content, organization, completeness, and quality",
    };

    const fileTypeContext =
      fileTypeDescriptions[responseType] || fileTypeDescriptions.OTHER;

    return `
    You are an expert educator evaluating a student's ${fileTypeContext} using the AEEG (Analyze, Evaluate, Explain, Guide) approach.
    
    QUESTION:
    {question}
    
    FILES SUBMITTED:
    {files}
    
    SCORING INFORMATION:
    Total Points Available: {total_points}
    Scoring Type: {scoring_type}
    Scoring Criteria: {scoring_criteria}
    
    CRITICAL GRADING INSTRUCTIONS:
    You MUST grade according to the EXACT rubric provided in the scoring criteria. If the scoring type is "CRITERIA_BASED" with rubrics:
    1. Evaluate the submission against EACH rubric question provided
    2. For EACH rubric:
       - Read the rubricQuestion carefully
       - Review ALL criteria options for that rubric
       - Select EXACTLY ONE criterion that best matches the student's performance
       - Award the EXACT points specified for that selected criterion (not an average or adjusted value)
    3. Do NOT use generic grading criteria unless specifically mentioned in the rubric
    4. Do NOT interpolate between criteria levels - select the ONE that best fits
    5. The total points awarded must equal the sum of points from the selected criterion for each rubric
    6. Include a rubricScores array in your response with one entry per rubric showing:
       - rubricQuestion: the exact text of the rubric question
       - pointsAwarded: the exact points from the selected criterion
       - maxPoints: the maximum possible points for that rubric
       - justification: why you selected that specific criterion level
    7. The total points must not exceed {total_points}
    
    GRADING APPROACH (AEEG):
    
    1. ANALYZE: Carefully examine the submitted files and describe what you observe
       - Identify the key elements and structure of the submission
       - Note specific techniques, approaches, or methodologies used
       - Observe the quality and completeness of the work
       - Recognize strengths and unique aspects of the submission
       - Focus your analysis on aspects relevant to the rubric criteria
    
    2. EVALUATE: For each rubric question in the scoring criteria:
       - Read the rubric question carefully
       - Examine how the submission addresses this specific rubric question
       - Compare the submission against ALL criterion levels for this rubric
       - Select EXACTLY ONE criterion that best matches the student's performance
       - Award the EXACT points specified for that selected criterion
       - Do NOT average, interpolate, or adjust points - use the exact value from the selected criterion
       - Record your selection in the rubricScores array
    
    3. EXPLAIN: Provide clear reasons for the grade based on specific observations
       - For each rubric, explain why you selected that specific criterion level
       - Reference specific parts of the submitted files
       - Connect your observations directly to the rubric descriptions
       - Justify points awarded with concrete evidence from the submission
       - Clearly articulate what was well-executed
       - Transparently address any deficiencies or areas that fell short
    
    4. GUIDE: Offer concrete suggestions for improvement
       - Provide specific, actionable feedback based on the rubric criteria
       - Suggest ways to reach higher criterion levels in each rubric
       - Recommend resources, techniques, or strategies for improvement
       - Focus guidance on the specific skills and competencies assessed by the rubrics
       - Include practical tips relevant to the submission type
    
    GRADING INSTRUCTIONS:
    - Be fair, consistent, and constructive in your evaluation
    - Use encouraging language while maintaining high standards
    - Ensure all feedback is specific to the files submitted
    - Consider the context and requirements of the assignment
    - For CRITERIA_BASED scoring, you MUST include rubricScores array
    
    LANGUAGE: {language}
    
    Respond with a JSON object containing:
    - Points awarded (sum of all rubric scores)
    - Comprehensive feedback incorporating all four AEEG components
    - Separate fields for each AEEG component
    - If scoring type is CRITERIA_BASED, include rubricScores array with score for each rubric
    
    {format_instructions}
    `;
  }
}
