import { PromptTemplate } from "@langchain/core/prompts";
import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { AIUsageType, ResponseType } from "@prisma/client";
import { StructuredOutputParser } from "langchain/output_parsers";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { FileUploadQuestionEvaluateModel } from "src/api/llm/model/file.based.question.evaluate.model";
import { FileBasedQuestionResponseModel } from "src/api/llm/model/file.based.question.response.model";
import { Logger } from "winston";
import { z } from "zod";
import { IModerationService } from "../../../core/interfaces/moderation.interface";
import { IPromptProcessor } from "../../../core/interfaces/prompt-processor.interface";
import { LLMResolverService } from "../../../core/services/llm-resolver.service";
import {
  LLM_RESOLVER_SERVICE,
  MODERATION_SERVICE,
  PROMPT_PROCESSOR,
} from "../../../llm.constants";
import { IFileGradingService } from "../interfaces/file-grading.interface";

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

@Injectable()
export class FileGradingService implements IFileGradingService {
  private readonly logger: Logger;

  constructor(
    @Inject(PROMPT_PROCESSOR)
    private readonly promptProcessor: IPromptProcessor,
    @Inject(MODERATION_SERVICE)
    private readonly moderationService: IModerationService,
    @Inject(LLM_RESOLVER_SERVICE)
    private readonly llmResolver: LLMResolverService,
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
    const extractedContent = learnerResponse
      .map((item) => item.content)
      .join(" ");
    const inputLength =
      question.length +
      extractedContent.length +
      JSON.stringify(scoringCriteria).length;
    const criteriaCount = Array.isArray(scoringCriteria)
      ? scoringCriteria.length
      : 1;

    const selectedModel = await this.llmResolver.getModelForGradingTask(
      "file_grading",
      responseType,
      inputLength,
      criteriaCount,
    );

    const response = await this.promptProcessor.processPrompt(
      prompt,
      assignmentId,
      AIUsageType.ASSIGNMENT_GRADING,
      selectedModel,
    );

    try {
      let parsedResponse = (await parser.parse(response)) as GradingOutput;

      let calculatedTotalPoints = 0;

      if (
        parsedResponse.rubricScores &&
        parsedResponse.rubricScores.length > 0
      ) {
        for (const score of parsedResponse.rubricScores) {
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
          // Create corrected response object
          parsedResponse = {
            ...parsedResponse,
            points: calculatedTotalPoints,
          };
        }
      }

      const fileBasedQuestionResponseModel = new FileBasedQuestionResponseModel(
        parsedResponse.points,
        parsedResponse.feedback,
        parsedResponse.analysis,
        parsedResponse.evaluation,
        parsedResponse.explanation,
        parsedResponse.guidance,
        parsedResponse.rubricScores,
      );

      const parsedPoints = fileBasedQuestionResponseModel.points;
      let finalModel = fileBasedQuestionResponseModel;

      if (parsedPoints > maxTotalPoints) {
        this.logger.warn(
          `LLM awarded ${parsedPoints} points, which exceeds maximum of ${maxTotalPoints}. Capping at maximum.`,
        );
        finalModel = new FileBasedQuestionResponseModel(
          maxTotalPoints,
          fileBasedQuestionResponseModel.feedback,
          fileBasedQuestionResponseModel.analysis,
          fileBasedQuestionResponseModel.evaluation,
          fileBasedQuestionResponseModel.explanation,
          fileBasedQuestionResponseModel.guidance,
          fileBasedQuestionResponseModel.rubricScores,
        );
      } else if (parsedPoints < 0) {
        this.logger.warn(
          `LLM awarded negative points (${parsedPoints}). Setting to 0.`,
        );
        finalModel = new FileBasedQuestionResponseModel(
          0,
          fileBasedQuestionResponseModel.feedback,
          fileBasedQuestionResponseModel.analysis,
          fileBasedQuestionResponseModel.evaluation,
          fileBasedQuestionResponseModel.explanation,
          fileBasedQuestionResponseModel.guidance,
          fileBasedQuestionResponseModel.rubricScores,
        );
      }

      return finalModel;
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
    Grade ${fileTypeContext} using AEEG approach.

    QUESTION: {question}
    FILES: {files}
    POINTS: {total_points} | TYPE: {scoring_type}
    CRITERIA: {scoring_criteria}

    RUBRIC RULES:
    - Select EXACTLY ONE criterion per rubric (no interpolation)
    - Award EXACT points from selected criterion
    - Total = sum of rubric points (max {total_points})
    - Include rubricScores array with: rubricQuestion, pointsAwarded, maxPoints, justification

    AEEG APPROACH:
    1. ANALYZE: Key elements, structure, techniques, quality
    2. EVALUATE: Match submission to each rubric criterion, select best fit
    3. EXPLAIN: Justify grade with specific evidence
    4. GUIDE: Actionable improvement suggestions

    LANGUAGE: {language}

    JSON Response:
    - Points (rubric sum)
    - Feedback (overall assessment)
    - Analysis (submission examination)
    - Evaluation (rubric-based scoring)
    - Explanation (grade justification)
    - Guidance (improvement tips)
    - rubricScores array (if CRITERIA_BASED)
    
    AVOID REDUNDANCY: Each field should contain unique information and not repeat content from other fields.
    
    Make sure your feedback is short and concise.

    {format_instructions}
    `;
  }
}
