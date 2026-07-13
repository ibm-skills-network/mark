import * as crypto from "node:crypto";
import { Readable } from "node:stream";
import { PromptTemplate } from "@langchain/core/prompts";
import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { AIUsageType, ResponseType } from "@prisma/client";
import axios from "axios";
import { StructuredOutputParser } from "@langchain/classic/output_parsers";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { ScoringDto } from "src/api/assignment/dto/update.questions.request.dto";
import { LearnerFileUpload } from "src/api/attempt/common/interfaces/attempt.interface";
import { PdfAnnotationService } from "src/api/attempt/services/pdf-annotation.service";
import {
  CanonicalSubmission,
  ContentBlock,
  EvidenceBasedGradingResult,
} from "src/api/attempt/services/structured-content.models";
import { S3Service } from "src/api/files/services/s3.service";
import { FileUploadQuestionEvaluateModel } from "src/api/llm/model/file.based.question.evaluate.model";
import { FileBasedQuestionResponseModel } from "src/api/llm/model/file.based.question.response.model";
import {
  FileHighlighting,
  serializeFileHighlighting,
} from "src/api/llm/model/highlighting.model";
import { Logger } from "winston";
import * as XLSX from "xlsx";
import { z } from "zod";
import { IModerationService } from "../../../core/interfaces/moderation.interface";
import { IPromptProcessor } from "../../../core/interfaces/prompt-processor.interface";
import { ITokenCounter } from "../../../core/interfaces/token-counter.interface";
import { LLMResolverService } from "../../../core/services/llm-resolver.service";
import { isContextLengthExceededError } from "../../../core/utils/llm-error.util";
import {
  LLM_RESOLVER_SERVICE,
  MODERATION_SERVICE,
  PROMPT_PROCESSOR,
  TOKEN_COUNTER,
} from "../../../llm.constants";
import { MAX_EVIDENCE_BLOCKS_PER_SUBMISSION } from "../constants";
import { OversizedSubmissionError } from "../errors/oversized-submission.error";
import { IFileGradingService } from "../interfaces/file-grading.interface";
import { RubricCriterion } from "../types/criterion-evidence.types";
import { ContentSummarizationService } from "./content-summarization.service";
import { EvidenceBasedGradingService } from "./evidence-based-grading.service";
import {
  extractExpectedFilenameFromText,
  filenamesMatch,
  mentionsFilenameRequirement,
} from "./spreadsheet-rubric.utils";
import { readClampedWorkbook } from "./spreadsheet-used-range.utils";

type RubricScore = {
  rubricQuestion: string;
  pointsAwarded: number;
  maxPoints: number;
  justification: string;
  evidence?: string[];
  status?: "full" | "partial" | "none" | "unknown";
  manualReviewRequired?: boolean;
  criterionSelected?: string;
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

type SpreadsheetCheckType =
  | "file_open"
  | "filename_match"
  | "empty_rows"
  | "duplicates"
  | "double_spaces"
  | "spelling"
  | "department_columns"
  | "column_width"
  | "headers"
  | "row_count"
  | "unknown";

type SpreadsheetCheckResult = {
  status: "full" | "partial" | "none" | "unknown";
  evidence: string[];
  notes?: string;
};

type SpreadsheetMetrics = {
  filename: string;
  sheetName: string;
  headers: string[];
  headerRowIndex: number;
  dataRowCount: number;
  emptyRowIndices: number[];
  duplicateRowPairs: Array<{ row: number; duplicateOf: number }>;
  doubleSpaceCells: Array<{ row: number; column: string; value: string }>;
  departmentColumns: Array<{ index: number; name: string }>;
  hasEmptyHeaders: boolean;
  columnWidths?: Array<number | null>;
  maxCellLengths?: number[];
};

type SpreadsheetRubricEvaluation = {
  rubricQuestion: string;
  pointsAwarded: number;
  maxPoints: number;
  status: "full" | "partial" | "none" | "unknown";
  evidence: string[];
  manualReviewRequired?: boolean;
  criterionSelected?: string;
  checkType: SpreadsheetCheckType;
};

type SpreadsheetCheckDefinition = {
  type: SpreadsheetCheckType;
  expectedRowCount?: number;
  expectedFilename?: string;
};

@Injectable()
export class FileGradingService implements IFileGradingService {
  private readonly logger: Logger;

  constructor(
    @Inject(PROMPT_PROCESSOR)
    private readonly promptProcessor: IPromptProcessor,
    @Inject(TOKEN_COUNTER)
    private readonly tokenCounter: ITokenCounter,
    @Inject(MODERATION_SERVICE)
    private readonly moderationService: IModerationService,
    @Inject(LLM_RESOLVER_SERVICE)
    private readonly llmResolver: LLMResolverService,
    private readonly evidenceBasedGrading: EvidenceBasedGradingService,
    private readonly pdfAnnotationService: PdfAnnotationService,
    private readonly s3Service: S3Service,
    private readonly contentSummarization: ContentSummarizationService,
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
      judgeFeedback,
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

    const questionMaxPoints = totalPoints;
    let maxTotalPoints = totalPoints;
    let rubricMaxTotal = 0;
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
        rubricMaxTotal = sum;
        maxTotalPoints = sum;
      }
    }

    const enrichedLearnerResponse =
      this.ensureStructuredContentForEvidenceGrading(learnerResponse);

    const hasRubrics =
      !!scoringCriteria?.rubrics &&
      Array.isArray(scoringCriteria.rubrics) &&
      scoringCriteria.rubrics.length > 0;

    const evidenceEligibleFiles = enrichedLearnerResponse.filter((file) =>
      this.isEvidenceBasedEligible(file),
    );
    const hasEvidenceEligibleContent = evidenceEligibleFiles.length > 0;

    this.logger.info("Checking for evidence-based grading trigger", {
      hasEvidenceEligibleContent,
      hasRubrics,
      scoringCriteriaType,
      filesCount: enrichedLearnerResponse.length,
      evidenceEligibleFilesCount: evidenceEligibleFiles.length,
    });

    const deterministicResult = await this.tryDeterministicSpreadsheetGrading(
      enrichedLearnerResponse,
      question,
      maxTotalPoints,
      scoringCriteriaType,
      scoringCriteria,
      responseType,
    );

    if (deterministicResult) {
      this.logger.info("Using deterministic spreadsheet grading result");
      return this.scaleFileBasedModelToQuestionMax(
        deterministicResult,
        questionMaxPoints,
        rubricMaxTotal,
      );
    }

    if (
      hasEvidenceEligibleContent &&
      hasRubrics &&
      scoringCriteriaType === "CRITERIA_BASED"
    ) {
      this.logger.info("Using evidence-based grading with structured content");
      const model = await this.gradeWithEvidenceBasedApproach(
        enrichedLearnerResponse,
        question,
        maxTotalPoints,
        scoringCriteria,
        assignmentId,
        language,
        rubricMaxPoints,
        judgeFeedback,
      );
      return this.scaleFileBasedModelToQuestionMax(
        model,
        questionMaxPoints,
        rubricMaxTotal,
      );
    }

    const selectedTemplate = this.getTemplateForFileType(responseType);

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

    const prompt = this.buildFileGradingPrompt({
      template: selectedTemplate,
      question,
      files: learnerResponse.map((item) => ({
        filename: item.filename,
        content: this.getFileContentForPrompt(item),
      })),
      maxTotalPoints,
      scoringCriteriaType,
      scoringCriteria,
      responseType,
      language,
      formatInstructions,
      judgeFeedback,
    });
    const extractedContent = learnerResponse
      .map((item) => this.getFileContentForPrompt(item))
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

    let response: string;
    try {
      const estimatedTokens = this.estimateTokensForFileGrading(
        question,
        extractedContent,
        scoringCriteria,
        selectedModel,
      );
      const safeTokenLimit =
        this.contentSummarization.getSafeContextLimit(selectedModel);

      if (estimatedTokens > safeTokenLimit) {
        this.logger.warn(
          `Input too large for model ${selectedModel}. Estimated ${estimatedTokens} tokens (limit ${safeTokenLimit}). Using chunked summarization.`,
        );

        const summarizedFiles = await this.summarizeFilesForGrading(
          learnerResponse,
          question,
          scoringCriteria,
          assignmentId,
          language ?? "en",
          selectedModel,
          safeTokenLimit,
        );

        const summarizedTemplate = this.getTemplateForFileType(
          responseType,
          true,
        );
        const summarizedPrompt = this.buildFileGradingPrompt({
          template: summarizedTemplate,
          question,
          files: summarizedFiles,
          maxTotalPoints,
          scoringCriteriaType,
          scoringCriteria,
          responseType,
          language,
          formatInstructions,
          judgeFeedback,
        });

        response = await this.processPromptWithRetry(
          summarizedPrompt,
          assignmentId,
          selectedModel,
          maxTotalPoints,
          rubricMaxPoints,
        );
      } else {
        response = await this.processPromptWithRetry(
          prompt,
          assignmentId,
          selectedModel,
          maxTotalPoints,
          rubricMaxPoints,
        );
      }
    } catch (retryError) {
      this.logger.error(
        `All LLM retry attempts failed: ${
          retryError instanceof Error ? retryError.message : String(retryError)
        }`,
      );
      const fallback = this.createFallbackResponse(
        maxTotalPoints,
        "All LLM models failed - using fallback grading",
        rubricMaxPoints,
      );
      return this.scaleFileBasedModelToQuestionMax(
        fallback,
        questionMaxPoints,
        rubricMaxTotal,
      );
    }

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

        if (
          scoringCriteriaType === "CRITERIA_BASED" &&
          parsedResponse.points !== calculatedTotalPoints
        ) {
          this.logger.warn(
            `LLM total points (${parsedResponse.points}) doesn't match sum of rubric scores (${calculatedTotalPoints}). Using rubric sum.`,
          );
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

      return this.scaleFileBasedModelToQuestionMax(
        finalModel,
        questionMaxPoints,
        rubricMaxTotal,
      );
    } catch (error) {
      this.logger.error(
        `Error parsing LLM response: ${
          error instanceof Error ? error.message : "Unknown error"
        }. Response: "${response?.slice(0, 200)}..."`,
      );

      const fallback = this.createFallbackResponse(
        maxTotalPoints,
        "Failed to parse LLM response - using fallback grading",
        rubricMaxPoints,
      );
      return this.scaleFileBasedModelToQuestionMax(
        fallback,
        questionMaxPoints,
        rubricMaxTotal,
      );
    }
  }

  /**
   * Process prompt with retry mechanism and fallback model
   */
  private async processPromptWithRetry(
    prompt: PromptTemplate,
    assignmentId: number,
    primaryModel: string,
    _maxTotalPoints: number,
    _rubricMaxPoints?: { rubricQuestion: string; maxPoints: number }[],
  ): Promise<string> {
    void _maxTotalPoints;
    void _rubricMaxPoints;
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.debug(
          `LLM attempt ${attempt}/${maxRetries} with model ${primaryModel}`,
        );

        const response = await this.promptProcessor.processPromptForFeature(
          prompt,
          assignmentId,
          AIUsageType.ASSIGNMENT_GRADING,
          "file_grading",
          primaryModel,
        );

        if (this.isValidLLMResponse(response)) {
          if (attempt > 1) {
            this.logger.info(
              `LLM succeeded on attempt ${attempt}/${maxRetries} with model ${primaryModel}`,
            );
          }
          return response;
        }

        this.logger.warn(
          `LLM returned invalid response on attempt ${attempt}/${maxRetries}: "${response?.slice(
            0,
            100,
          )}..."`,
        );
        lastError = new Error(
          `Invalid LLM response: ${response?.slice(0, 100)}`,
        );
      } catch (error) {
        // A context_length_exceeded 400 is deterministic for a given prompt:
        // neither a same-model retry nor the fallback-model resend below can
        // ever succeed, so propagate it immediately instead of burning the
        // remaining ladder on an identical request.
        if (isContextLengthExceededError(error)) {
          this.logger.error("file.grading.context.length.exceeded", {
            assignmentId,
            attempt,
            primaryModel,
          });
          throw error;
        }

        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(
          `LLM attempt ${attempt}/${maxRetries} failed with model ${primaryModel}: ${lastError.message}`,
        );
      }

      if (attempt < maxRetries) {
        await this.delay(Math.pow(2, attempt - 1) * 1000);
      }
    }

    try {
      const fallbackModel = await this.llmResolver.getModelKeyWithFallback(
        "file_grading_fallback",
        "gpt-4o-mini",
      );
      this.logger.warn(
        `Primary model ${primaryModel} failed after ${maxRetries} attempts, trying fallback model ${fallbackModel}`,
      );

      const response = await this.promptProcessor.processPromptForFeature(
        prompt,
        assignmentId,
        AIUsageType.ASSIGNMENT_GRADING,
        "file_grading",
        fallbackModel,
      );

      if (this.isValidLLMResponse(response)) {
        this.logger.info(`Fallback model ${fallbackModel} succeeded`);
        return response;
      }

      this.logger.error(
        `Fallback model ${fallbackModel} also returned invalid response`,
      );
    } catch (fallbackError) {
      this.logger.error(
        `Fallback model also failed: ${
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError)
        }`,
      );
    }

    throw lastError || new Error("All LLM attempts failed");
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

  /**
   * Create a fallback response when LLM fails
   */
  private createFallbackResponse(
    maxTotalPoints: number,
    reason: string,
    rubricMaxPoints?: { rubricQuestion: string; maxPoints: number }[],
  ): FileBasedQuestionResponseModel {
    const fallbackPoints =
      maxTotalPoints > 0 ? Math.floor(maxTotalPoints * 0.5) : 0;

    const fallbackRubricScores =
      rubricMaxPoints?.map((rubric) => ({
        rubricQuestion: rubric.rubricQuestion,
        pointsAwarded: Math.floor(rubric.maxPoints * 0.5),
        maxPoints: rubric.maxPoints,
        justification:
          "Automatic scoring temporarily unavailable - partial credit awarded pending manual review",
      })) || [];

    return new FileBasedQuestionResponseModel(
      fallbackPoints,
      `Automated grading temporarily unavailable. ${reason}. Partial credit (${fallbackPoints}/${maxTotalPoints}) awarded pending manual review.`,
      "Automatic analysis unavailable due to technical issues.",
      "Unable to complete automated evaluation at this time.",
      "This submission requires manual review due to system limitations.",
      "Please contact your instructor for manual grading of this submission.",
      fallbackRubricScores,
    );
  }

  private createMinimumEvidenceResponse(
    maxTotalPoints: number,
    scoringCriteria?: ScoringDto,
  ): FileBasedQuestionResponseModel {
    const rubricScores: RubricScore[] = [];

    if (scoringCriteria?.rubrics && Array.isArray(scoringCriteria.rubrics)) {
      for (const rubric of scoringCriteria.rubrics) {
        const pointsList = rubric.criteria?.map((c) => c.points) ?? [];
        const minPoints = pointsList.length > 0 ? Math.min(...pointsList) : 0;
        const maxPoints = pointsList.length > 0 ? Math.max(...pointsList) : 0;

        rubricScores.push({
          rubricQuestion: rubric.rubricQuestion || "Unnamed rubric",
          pointsAwarded: minPoints,
          maxPoints,
          justification: "No supporting evidence found in the submission.",
          evidence: [],
          status: "none",
          manualReviewRequired: false,
        });
      }
    }

    const totalPoints =
      rubricScores.length > 0
        ? rubricScores.reduce(
            (sum, score) => sum + (score.pointsAwarded || 0),
            0,
          )
        : 0;

    const feedback =
      rubricScores.length > 0
        ? "Automated evidence checks could not be completed. Points were assigned at the minimum for each criterion due to missing evidence."
        : "Automated evidence checks could not be completed. No rubric criteria were available for scoring.";

    return new FileBasedQuestionResponseModel(
      totalPoints,
      feedback,
      "Evidence-based grading was unable to extract valid evidence.",
      "Each criterion was assigned minimum points due to missing evidence.",
      "No supporting evidence could be verified for the rubric criteria.",
      "Provide clear, explicit evidence in the submission that matches each rubric criterion.",
      rubricScores,
    );
  }

  private scaleFileBasedModelToQuestionMax(
    model: FileBasedQuestionResponseModel,
    questionMaxPoints: number,
    rubricMaxTotal: number,
  ): FileBasedQuestionResponseModel {
    if (
      !questionMaxPoints ||
      questionMaxPoints <= 0 ||
      !rubricMaxTotal ||
      rubricMaxTotal <= 0 ||
      rubricMaxTotal <= questionMaxPoints
    ) {
      return model;
    }

    const scaleFactor = questionMaxPoints / rubricMaxTotal;

    const scaledRubricScores = model.rubricScores?.map((score) => {
      if (typeof score.pointsAwarded !== "number") {
        return score;
      }
      return {
        ...score,
        pointsAwarded: this.roundScaledPoints(
          score.pointsAwarded * scaleFactor,
        ),
      };
    });

    const rubricSum = scaledRubricScores?.reduce((sum, score) => {
      const points =
        typeof score.pointsAwarded === "number" ? score.pointsAwarded : 0;
      return sum + points;
    }, 0);

    const scaledPointsBase =
      typeof rubricSum === "number" && rubricSum > 0
        ? rubricSum
        : model.points * scaleFactor;

    const scaledPoints = Math.min(
      questionMaxPoints,
      Math.max(0, this.roundScaledPoints(scaledPointsBase)),
    );

    this.logger.warn(
      "Scaling file grading score to match question max points",
      {
        originalPoints: model.points,
        scaledPoints,
        questionMaxPoints,
        rubricMaxTotal,
        scaleFactor,
      },
    );

    return new FileBasedQuestionResponseModel(
      scaledPoints,
      model.feedback,
      model.analysis,
      model.evaluation,
      model.explanation,
      model.guidance,
      scaledRubricScores ?? model.rubricScores,
      model.highlighting,
      model.annotatedPdfUrl,
    );
  }

  private roundScaledPoints(points: number): number {
    return Math.round(points * 100) / 100;
  }

  private getTemplateForFileType(
    responseType: ResponseType,
    summarized = false,
  ): string {
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

    const summaryNote = summarized
      ? "\n    NOTE: FILES contain summarized extracts of the submission. If details are missing, be conservative and say what evidence is insufficient.\n"
      : "";

    return `
    Grade ${fileTypeContext} using AEEG approach.

    QUESTION: {question}
    FILES: {files}
    POINTS: {total_points} | TYPE: {scoring_type}
    CRITERIA: {scoring_criteria}
    ${summaryNote}

    JUDGE FEEDBACK (if any): {judge_feedback}
    - If judge feedback is provided, correct those issues without re-evaluating unrelated criteria.

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

    FEEDBACK REQUIREMENTS:
    - Focus on what the learner DID or DID NOT include in their submission
    - If criteria are fully met: Acknowledge what was correctly done or demonstrated
    - If criteria are partially met: Point out what was included AND what specific elements are missing
    - If criteria are NOT met: Explain what specific content, concepts, or elements are absent
    - Be specific about gaps: name the missing elements, explanations, or details
    - Frame as actionable guidance: "The submission should include..." or "Consider adding..."
    - NO criterion requirements statements, NO subjective adjectives, NO encouragement, NO praise
    - Do NOT start with "Criterion requires..." or similar phrasing
    - Focus on the work itself, not what the rubric asks for

    LANGUAGE: {language}

    JSON Response:
    - Points (rubric sum)
    - Feedback (overall assessment using learner-focused language)
    - Analysis (submission examination)
    - Evaluation (rubric-based scoring)
    - Explanation (grade justification with specific examples)
    - Guidance (concrete improvement tips)
    - rubricScores array (if CRITERIA_BASED)

    AVOID REDUNDANCY: Each field should contain unique information and not repeat content from other fields.

    Make sure your feedback is short and concise.

    {format_instructions}
    `;
  }

  private buildFileGradingPrompt({
    template,
    question,
    files,
    maxTotalPoints,
    scoringCriteriaType,
    scoringCriteria,
    responseType,
    language,
    formatInstructions,
    judgeFeedback,
  }: {
    template: string;
    question: string;
    files: Array<Record<string, unknown>>;
    maxTotalPoints: number;
    scoringCriteriaType: string;
    scoringCriteria: ScoringDto;
    responseType: ResponseType;
    language?: string;
    formatInstructions: string;
    judgeFeedback?: string;
  }): PromptTemplate {
    return new PromptTemplate({
      template,
      inputVariables: [],
      partialVariables: {
        question: () => question,
        files: () => JSON.stringify(files),
        total_points: () => maxTotalPoints.toString(),
        scoring_type: () => scoringCriteriaType,
        scoring_criteria: () => this.safeStringify(scoringCriteria),
        grading_type: () => responseType,
        language: () => language ?? "en",
        judge_feedback: () => judgeFeedback || "No judge feedback provided.",
        format_instructions: () => formatInstructions,
      },
    });
  }

  private getFileContentForPrompt(item: LearnerFileUpload): string {
    return (
      item.content ||
      item.contentSummary ||
      item.extractedText ||
      item.filename ||
      ""
    );
  }

  private ensureStructuredContentForEvidenceGrading(
    learnerResponse: LearnerFileUpload[],
  ): LearnerFileUpload[] {
    const needsRebuild = learnerResponse.some((file) =>
      this.shouldRebuildStructuredContent(file),
    );

    if (
      !needsRebuild &&
      learnerResponse.some((file) => file.structuredContent)
    ) {
      return learnerResponse;
    }

    return learnerResponse.map((file) => {
      if (!this.shouldRebuildStructuredContent(file)) {
        return { ...file };
      }

      const text =
        file.extractedText || file.content || file.contentSummary || "";

      const structuredContent = this.buildCanonicalSubmissionFromText(
        text,
        file,
      );

      return { ...file, structuredContent };
    });
  }

  private shouldRebuildStructuredContent(file: LearnerFileUpload): boolean {
    const text =
      file.extractedText || file.content || file.contentSummary || "";

    const filename = file.filename?.toLowerCase() ?? "";
    const isSpreadsheet =
      file.fileType?.includes("sheet") ||
      filename.endsWith(".xlsx") ||
      filename.endsWith(".xls") ||
      filename.endsWith(".csv") ||
      filename.endsWith(".tsv") ||
      filename.endsWith(".ods") ||
      text.includes("=== EXCEL WORKBOOK ===") ||
      text.includes("=== SHEET:");

    if (isSpreadsheet) {
      // Spreadsheets may need a rebuild even when structuredContent exists
      // (low block count or raw tab characters indicate the tabular structure
      // was not captured on the first pass).
      const existing = file.structuredContent;
      if (!existing) return true;

      const blockCount = existing.metadata?.blockCount ?? 0;
      if (blockCount < 10) return true;
      if (text.includes("\t")) return true;

      return false;
    }

    if (this.isSourceCodeFile(file)) {
      return false;
    }

    return !file.structuredContent && this.hasExtractedSubmissionText(file);
  }

  private isEvidenceBasedEligible(file: LearnerFileUpload): boolean {
    if (!file.structuredContent) return false;
    if (this.isSourceCodeFile(file)) return false;

    // The PDF structured extractor sets structureQuality; "low" means the
    // extraction was too sparse to support evidence retrieval.
    if (file.metadata?.structureQuality === "low") return false;

    return true;
  }

  private isSourceCodeFile(file: LearnerFileUpload): boolean {
    const filename = file.filename?.toLowerCase() ?? "";
    return /\.(py|java|cpp|cc|cxx|c|h|hpp|hh|js|jsx|mjs|cjs|ts|tsx|go|rs|rb|cs|php|swift|kt|kts|scala|sql|sh|bash|pl|pm|lua|dart|m|mm)$/.test(
      filename,
    );
  }

  private hasExtractedSubmissionText(file: LearnerFileUpload): boolean {
    return Boolean(
      (file.extractedText || file.content || file.contentSummary || "").trim(),
    );
  }

  private buildCanonicalSubmissionFromText(
    text: string,
    file: LearnerFileUpload,
  ): CanonicalSubmission {
    const rawText = text || "";
    const normalized = this.normalizeSubmissionTextForEvidence(rawText);
    const metadataBlock = this.buildFileMetadataBlock(file, normalized);
    const validatorBlock = this.buildValidatorReportBlock(rawText, file);
    const blocks: ContentBlock[] = [];
    let blockIndex = 1;

    if (metadataBlock) {
      blocks.push({
        ...metadataBlock,
        blockId: `p1b${blockIndex}`,
        page: 1,
      });
      blockIndex += 1;
    }

    if (validatorBlock) {
      blocks.push({
        ...validatorBlock,
        blockId: `p1b${blockIndex}`,
        page: 1,
      });
      blockIndex += 1;
    }

    const textBlocks = this.splitTextIntoEvidenceBlocks(
      normalized,
      blockIndex,
      {
        filename: file.filename,
        questionId: file.questionId,
      },
    );
    for (const block of textBlocks) {
      blocks.push(block);
    }

    const wordCount = normalized
      ? normalized.split(/\s+/).filter(Boolean).length
      : 0;
    const checksum = crypto
      .createHash("sha256")
      .update(normalized)
      .digest("hex");

    return {
      submissionId: file.filename,
      metadata: {
        wordCount,
        pageCount: 1,
        blockCount: blocks.length,
        sourceType: "txt",
        checksum,
        extractedAt: new Date().toISOString(),
      },
      pages: [
        {
          pageNumber: 1,
          blocks,
        },
      ],
    };
  }

  private splitTextIntoEvidenceBlocks(
    text: string,
    startIndex = 1,
    meta?: { filename?: string; questionId?: number; attemptId?: number },
  ): ContentBlock[] {
    if (!text) {
      return [
        {
          blockId: `p1b${startIndex}`,
          type: "paragraph",
          text: "",
          page: 1,
        },
      ];
    }

    const isTabular =
      text.includes("=== EXCEL WORKBOOK ===") ||
      text.includes("=== SHEET:") ||
      text.includes(" | ");

    if (isTabular) {
      // Build the trimmed, non-empty line set once and count THAT against the
      // cap. Blank/whitespace-only rows never become evidence blocks, so they
      // must not count toward (or inflate) the reported total. Counting the
      // filtered array length before constructing ContentBlock objects keeps
      // the "reject before allocating" intent: a pathological spreadsheet is
      // short-circuited before the blocks array is built.
      const lines = text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.length > MAX_EVIDENCE_BLOCKS_PER_SUBMISSION) {
        this.logger.warn("grading.submission.oversized", {
          blockCount: lines.length,
          cap: MAX_EVIDENCE_BLOCKS_PER_SUBMISSION,
          filename: meta?.filename,
          questionId: meta?.questionId,
          attemptId: meta?.attemptId,
          branch: "tabular",
        });
        throw new OversizedSubmissionError({
          blockCount: lines.length,
          cap: MAX_EVIDENCE_BLOCKS_PER_SUBMISSION,
          filename: meta?.filename,
          questionId: meta?.questionId,
          attemptId: meta?.attemptId,
        });
      }

      const blocks: ContentBlock[] = [];
      let index = startIndex;

      for (const line of lines) {
        blocks.push({
          blockId: `p1b${index}`,
          type: "paragraph",
          text: line,
          page: 1,
        });
        index += 1;
      }

      return blocks.length > 0
        ? blocks
        : [
            {
              blockId: `p1b${startIndex}`,
              type: "paragraph",
              text: "",
              page: 1,
            },
          ];
    }

    const paragraphs = text
      .split(/\n{2,}/)
      .map((chunk) => chunk.trim())
      .filter(Boolean);

    const blocksSource = paragraphs.length > 0 ? paragraphs : text.split(/\n+/);

    if (blocksSource.length > MAX_EVIDENCE_BLOCKS_PER_SUBMISSION) {
      this.logger.warn("grading.submission.oversized", {
        blockCount: blocksSource.length,
        cap: MAX_EVIDENCE_BLOCKS_PER_SUBMISSION,
        filename: meta?.filename,
        questionId: meta?.questionId,
        attemptId: meta?.attemptId,
        branch: "paragraph",
      });
      throw new OversizedSubmissionError({
        blockCount: blocksSource.length,
        cap: MAX_EVIDENCE_BLOCKS_PER_SUBMISSION,
        filename: meta?.filename,
        questionId: meta?.questionId,
        attemptId: meta?.attemptId,
      });
    }

    const blocks: ContentBlock[] = [];
    let index = startIndex;
    for (const chunk of blocksSource) {
      const trimmed = chunk.trim();
      if (!trimmed) continue;
      blocks.push({
        blockId: `p1b${index}`,
        type: "paragraph",
        text: trimmed,
        page: 1,
      });
      index += 1;
    }

    if (blocks.length === 0) {
      blocks.push({
        blockId: "p1b1",
        type: "paragraph",
        text: "",
        page: 1,
      });
    }

    return blocks;
  }

  private normalizeSubmissionTextForEvidence(text: string): string {
    const base = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
    const isSpreadsheet =
      base.includes("=== EXCEL WORKBOOK ===") || base.includes("=== SHEET:");
    const tabReplacement = isSpreadsheet ? " | " : " ";
    return (
      base
        .replaceAll("\t", tabReplacement)
        // eslint-disable-next-line no-control-regex
        .replaceAll(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
        .trim()
    );
  }

  private buildValidatorReportBlock(
    rawText: string,
    file: LearnerFileUpload,
  ): ContentBlock | null {
    if (!this.isSpreadsheetEvidenceSource(rawText, file)) {
      return null;
    }

    const metrics = this.buildSpreadsheetMetricsFromText(
      rawText,
      file.filename,
    );
    if (!metrics) return null;

    const lines: string[] = [];
    lines.push(
      "=== VALIDATOR REPORT ===",
      `uploaded_filename: ${metrics.filename}`,
      `sheet: ${metrics.sheetName}`,
      `data_rows: ${metrics.dataRowCount}`,
      `empty_rows: ${metrics.emptyRowIndices.length}`,
      `duplicate_rows: ${metrics.duplicateRowPairs.length}`,
    );

    if (metrics.duplicateRowPairs.length > 0) {
      const samplePairs = metrics.duplicateRowPairs
        .slice(0, 3)
        .map((pair) => `row ${pair.row} duplicates row ${pair.duplicateOf}`)
        .join("; ");
      lines.push(`duplicate_examples: ${samplePairs}`);
    }

    lines.push(`double_space_cells: ${metrics.doubleSpaceCells.length}`);
    if (metrics.doubleSpaceCells.length > 0) {
      const sampleCells = metrics.doubleSpaceCells
        .slice(0, 3)
        .map((cell) => `${cell.column}${cell.row} "${cell.value}"`)
        .join("; ");
      lines.push(`double_space_examples: ${sampleCells}`);
    }

    const departmentNames = metrics.departmentColumns.map((col) => col.name);
    lines.push(
      `department_columns: ${
        departmentNames.length > 0 ? departmentNames.join(", ") : "none"
      }`,
      `column_count: ${metrics.headers.length}`,
    );

    const unnecessaryRemoved =
      metrics.departmentColumns.length === 1 &&
      !metrics.hasEmptyHeaders &&
      metrics.headers.length <= 3;
    lines.push(
      `unnecessary_columns_removed: ${unnecessaryRemoved ? "yes" : "no"}`,
    );

    const widthStatus = this.getColumnWidthStatus(metrics);
    lines.push(
      `column_widths: ${widthStatus}`,
      "spelling_check: not_supported",
    );

    return {
      blockId: "p1b0",
      type: "paragraph",
      text: lines.join("\n"),
      page: 1,
    };
  }

  private isSpreadsheetEvidenceSource(
    text: string,
    file: LearnerFileUpload,
  ): boolean {
    const filename = file.filename?.toLowerCase() || "";
    if (
      filename.endsWith(".xlsx") ||
      filename.endsWith(".xls") ||
      filename.endsWith(".csv")
    ) {
      return true;
    }
    if (
      file.fileType?.includes("spreadsheet") ||
      file.fileType?.includes("excel")
    ) {
      return true;
    }
    return (
      text.includes("=== EXCEL WORKBOOK ===") || text.includes("=== SHEET:")
    );
  }

  private buildSpreadsheetMetricsFromText(
    text: string,
    filename: string,
  ): SpreadsheetMetrics | null {
    if (!text) return null;

    const lines = text
      .replaceAll("\r\n", "\n")
      .replaceAll("\r", "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const rows: string[][] = [];
    for (const line of lines) {
      if (
        line.startsWith("===") ||
        line.startsWith("Range:") ||
        line.startsWith("Total Sheets:")
      ) {
        continue;
      }

      let cells = line.split("\t");
      if (cells.length <= 1) {
        cells = line.split(/\s*\|\s*/);
      }

      if (cells.length <= 1) {
        continue;
      }

      rows.push(cells.map((cell) => this.normalizeSpreadsheetCell(cell)));
    }

    if (rows.length === 0) {
      return null;
    }

    const headerRowIndex = rows.findIndex((row) =>
      row.some((cell) => cell.trim() !== ""),
    );

    const headers =
      headerRowIndex >= 0
        ? rows[headerRowIndex].map((cell) => cell.trim())
        : [];

    const dataRows = headerRowIndex >= 0 ? rows.slice(headerRowIndex + 1) : [];

    let lastDataIndex = dataRows.length - 1;
    while (
      lastDataIndex >= 0 &&
      this.isSpreadsheetRowEmpty(dataRows[lastDataIndex] || [])
    ) {
      lastDataIndex -= 1;
    }

    const trimmedDataRows =
      lastDataIndex >= 0 ? dataRows.slice(0, lastDataIndex + 1) : [];

    const emptyRowIndices: number[] = [];
    const duplicateRowPairs: Array<{ row: number; duplicateOf: number }> = [];
    const doubleSpaceCells: Array<{
      row: number;
      column: string;
      value: string;
    }> = [];

    const seen = new Map<string, number>();
    const dataStartRowNumber = headerRowIndex >= 0 ? headerRowIndex + 2 : 1;

    for (const [rowIndex, row] of trimmedDataRows.entries()) {
      const rowNumber = dataStartRowNumber + rowIndex;

      if (this.isSpreadsheetRowEmpty(row)) {
        emptyRowIndices.push(rowNumber);
        continue;
      }

      const normalizedKey = row
        .map((cell) => cell.trim().replaceAll(/\s+/g, " ").toLowerCase())
        .join("|");

      if (seen.has(normalizedKey)) {
        duplicateRowPairs.push({
          row: rowNumber,
          duplicateOf: seen.get(normalizedKey) || rowNumber,
        });
      } else {
        seen.set(normalizedKey, rowNumber);
      }

      for (const [colIndex, cell] of row.entries()) {
        if (
          typeof cell === "string" &&
          /\s{2,}/.test(cell) &&
          doubleSpaceCells.length < 10
        ) {
          doubleSpaceCells.push({
            row: rowNumber,
            column: this.columnIndexToLetter(colIndex),
            value: cell,
          });
        }
      }
    }

    const departmentColumns = headers
      .map((name, index) => ({ index, name }))
      .filter((col) => /department|dept/i.test(col.name));

    const hasEmptyHeaders = headers.some(
      (header) => header.trim().length === 0,
    );

    const maxCellLengths: number[] = [];
    const rowsForLengths =
      headerRowIndex >= 0 ? [headers, ...trimmedDataRows] : trimmedDataRows;

    for (const row of rowsForLengths) {
      for (const [colIndex, cell] of row.entries()) {
        const length = cell.trim().length;
        maxCellLengths[colIndex] =
          maxCellLengths[colIndex] === undefined
            ? length
            : Math.max(maxCellLengths[colIndex], length);
      }
    }

    return {
      filename,
      sheetName: "Sheet1",
      headers,
      headerRowIndex,
      dataRowCount: trimmedDataRows.length,
      emptyRowIndices,
      duplicateRowPairs,
      doubleSpaceCells,
      departmentColumns,
      hasEmptyHeaders,
      columnWidths: undefined,
      maxCellLengths,
    };
  }

  private getColumnWidthStatus(metrics: SpreadsheetMetrics): string {
    if (!metrics.columnWidths || metrics.columnWidths.length === 0) {
      return "unknown";
    }

    const widthPairs = metrics.columnWidths.map((width, index) => ({
      width,
      maxLen: metrics.maxCellLengths[index] ?? 0,
    }));

    if (
      widthPairs.every(
        (pair) => pair.width !== null && pair.width >= pair.maxLen,
      )
    ) {
      return "wide_enough";
    }

    if (widthPairs.some((pair) => pair.width === null)) {
      return "unknown";
    }

    return "possibly_truncated";
  }

  private buildFileMetadataBlock(
    file: LearnerFileUpload,
    normalizedText: string,
  ): ContentBlock | null {
    if (!file?.filename) return null;

    const meta = file.metadata || {};
    const lines: string[] = [];

    lines.push(`Filename: ${file.filename}`);
    if (file.fileType) {
      lines.push(`File type: ${file.fileType}`);
    }

    const mimeType = meta["mimeType"];
    if (typeof mimeType === "string" && mimeType) {
      lines.push(`MIME type: ${mimeType}`);
    }

    const size = meta["size"];
    if (typeof size === "number" && Number.isFinite(size)) {
      lines.push(`File size: ${size} bytes`);
    }

    const sheetCount = meta["sheetCount"];
    if (typeof sheetCount === "number" && Number.isFinite(sheetCount)) {
      lines.push(`Sheet count: ${sheetCount}`);
    }

    const pageCount = meta["pageCount"];
    if (typeof pageCount === "number" && Number.isFinite(pageCount)) {
      lines.push(`Page count: ${pageCount}`);
    }

    if (meta["hash"]) {
      lines.push(`File hash: ${String(meta["hash"])}`);
    }

    if (normalizedText.trim().length > 0) {
      lines.push("Content extracted: yes");
    } else {
      lines.push("Content extracted: no");
    }

    return {
      blockId: "p1b0",
      type: "paragraph",
      text: lines.join("\n"),
      page: 1,
    };
  }

  private async tryDeterministicSpreadsheetGrading(
    learnerResponse: LearnerFileUpload[],
    question: string,
    maxTotalPoints: number,
    scoringCriteriaType: string,
    scoringCriteria: ScoringDto,
    responseType: ResponseType,
  ): Promise<FileBasedQuestionResponseModel | null> {
    if (scoringCriteriaType !== "CRITERIA_BASED") {
      return null;
    }

    if (!this.isSpreadsheetSubmission(responseType, learnerResponse)) {
      return null;
    }

    if (!scoringCriteria?.rubrics || !Array.isArray(scoringCriteria.rubrics)) {
      return null;
    }

    const workbookInfo = await this.loadSpreadsheetWorkbook(learnerResponse);
    if (!workbookInfo) {
      this.logger.warn(
        "Deterministic spreadsheet grading skipped - unable to load workbook",
      );
      return null;
    }

    const metrics = this.buildSpreadsheetMetrics(
      workbookInfo.workbook,
      workbookInfo.filename,
    );

    const rubricChecks = scoringCriteria.rubrics.map((rubric) =>
      this.identifySpreadsheetCheck(rubric),
    );

    const hasUnknownChecks = rubricChecks.some(
      (check) => check.type === "unknown",
    );

    if (hasUnknownChecks) {
      this.logger.info(
        "Deterministic spreadsheet grading skipped - unknown rubric criteria",
        {
          rubricQuestions: scoringCriteria.rubrics.map(
            (rubric) => rubric.rubricQuestion,
          ),
        },
      );
      return null;
    }

    type RubricInput = ScoringDto["rubrics"][number];

    const evaluations: SpreadsheetRubricEvaluation[] = scoringCriteria.rubrics
      .map((rubric: RubricInput, index: number) => {
        const check = rubricChecks[index];
        const result = this.evaluateSpreadsheetCheck(check, metrics);
        const maxPoints =
          rubric.criteria.length > 0
            ? Math.max(
                ...rubric.criteria.map((criterion) => criterion.points || 0),
              )
            : 0;
        const { points, criterion } = this.selectPointsForStatus(
          rubric.criteria,
          result.status,
        );
        const manualReviewRequired = result.status === "unknown";
        const evidence = result.evidence;

        return {
          rubricQuestion: rubric.rubricQuestion || `Criterion ${index + 1}`,
          pointsAwarded: points,
          maxPoints,
          status: result.status,
          evidence,
          manualReviewRequired,
          criterionSelected: criterion?.description,
          checkType: check.type,
        };
      })
      .filter((evaluation) => evaluation.maxPoints > 0);

    if (evaluations.length === 0) {
      return null;
    }

    const totalPoints = evaluations.reduce(
      (sum, evaluation) => sum + evaluation.pointsAwarded,
      0,
    );

    this.logger.info("Deterministic spreadsheet grading applied", {
      filename: metrics.filename,
      sheetName: metrics.sheetName,
      rubricCount: evaluations.length,
      totalPoints,
    });

    const feedbackPayload = this.buildSpreadsheetFeedback(
      question,
      maxTotalPoints,
      metrics,
      evaluations,
    );

    const rubricScores: RubricScore[] = evaluations.map((evaluation) => {
      const justification = evaluation.manualReviewRequired
        ? `${evaluation.evidence.join(" ")} Manual review required.`
        : evaluation.evidence.join(" ");

      return {
        rubricQuestion: evaluation.rubricQuestion,
        pointsAwarded: evaluation.pointsAwarded,
        maxPoints: evaluation.maxPoints,
        justification,
        evidence: evaluation.evidence,
        status: evaluation.status,
        manualReviewRequired: evaluation.manualReviewRequired,
        criterionSelected: evaluation.criterionSelected,
      };
    });

    return new FileBasedQuestionResponseModel(
      totalPoints,
      feedbackPayload.feedback,
      feedbackPayload.analysis,
      feedbackPayload.evaluation,
      feedbackPayload.explanation,
      feedbackPayload.guidance,
      rubricScores,
    );
  }

  private isSpreadsheetSubmission(
    responseType: ResponseType,
    learnerResponse: LearnerFileUpload[],
  ): boolean {
    if (responseType === ResponseType.SPREADSHEET) {
      return true;
    }

    const spreadsheetExtensions = new Set(["xlsx", "xls", "csv", "tsv", "ods"]);

    return learnerResponse.some((file) => {
      const extension = file.filename.split(".").pop()?.toLowerCase() || "";
      return spreadsheetExtensions.has(extension);
    });
  }

  private async loadSpreadsheetWorkbook(
    learnerResponse: LearnerFileUpload[],
  ): Promise<{ workbook: XLSX.WorkBook; filename: string } | null> {
    const spreadsheetExtensions = new Set(["xlsx", "xls", "csv", "tsv", "ods"]);

    for (const file of learnerResponse) {
      const extension = file.filename.split(".").pop()?.toLowerCase() || "";
      if (!spreadsheetExtensions.has(extension)) continue;

      const buffer = await this.fetchFileBuffer(file, extension);
      if (!buffer) continue;

      try {
        const options: XLSX.ParsingOptions & { FS?: string } = {
          cellText: true,
          cellDates: true,
        };

        if (extension === "tsv") {
          options.FS = "\t";
        }

        // Stubs stay OFF and every sheet is clamped to its real used range:
        // a declared full-sheet dimension (A1:XFD1048576) would otherwise
        // materialize a placeholder per virtual cell at parse time and a row
        // per virtual row in every later sheet walk.
        const workbook = readClampedWorkbook(buffer, options);
        if (workbook.SheetNames.length === 0) {
          continue;
        }

        return { workbook, filename: file.filename };
      } catch (error) {
        this.logger.warn(
          `Failed to parse spreadsheet ${file.filename}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return null;
  }

  private async fetchFileBuffer(
    file: LearnerFileUpload,
    extension: string,
  ): Promise<Buffer | null> {
    if (file.bucket && file.key) {
      try {
        const object = await this.s3Service.getObject({
          Bucket: file.bucket,
          Key: file.key,
        });
        const buffer = await this.bodyToBuffer(object.Body);
        if (buffer) return buffer;
      } catch (error) {
        this.logger.warn(
          `Failed to fetch file ${file.filename} from storage: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (file.content) {
      return Buffer.from(file.content, "utf8");
    }

    if ((extension === "csv" || extension === "tsv") && file.extractedText) {
      return Buffer.from(file.extractedText, "utf8");
    }

    return null;
  }

  private async bodyToBuffer(body: unknown): Promise<Buffer | null> {
    if (!body) return null;
    if (Buffer.isBuffer(body)) return body;
    if (body instanceof Uint8Array) return Buffer.from(body);
    if (typeof body === "string") return Buffer.from(body);

    if (body instanceof Readable) {
      const chunks: Buffer[] = [];
      for await (const chunk of body) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    }

    return null;
  }

  private buildSpreadsheetMetrics(
    workbook: XLSX.WorkBook,
    filename: string,
  ): SpreadsheetMetrics {
    const sheetName = workbook.SheetNames[0] || "Sheet1";
    const worksheet = workbook.Sheets[sheetName];
    const rowsRaw = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      blankrows: true,
      defval: "",
    });

    const rows = rowsRaw.map((row) =>
      Array.isArray(row)
        ? row.map((cell) => this.normalizeSpreadsheetCell(cell))
        : [],
    );

    const headerRowIndex = rows.findIndex((row) =>
      row.some((cell) => cell.trim() !== ""),
    );

    const headers =
      headerRowIndex >= 0
        ? rows[headerRowIndex].map((cell) => cell.trim())
        : [];

    const dataRows = headerRowIndex >= 0 ? rows.slice(headerRowIndex + 1) : [];

    let lastDataIndex = dataRows.length - 1;
    while (
      lastDataIndex >= 0 &&
      this.isSpreadsheetRowEmpty(dataRows[lastDataIndex])
    ) {
      lastDataIndex -= 1;
    }

    const trimmedDataRows =
      lastDataIndex >= 0 ? dataRows.slice(0, lastDataIndex + 1) : [];

    const emptyRowIndices: number[] = [];
    const duplicateRowPairs: Array<{ row: number; duplicateOf: number }> = [];
    const doubleSpaceCells: Array<{
      row: number;
      column: string;
      value: string;
    }> = [];

    const seen = new Map<string, number>();
    const dataStartRowNumber = headerRowIndex >= 0 ? headerRowIndex + 2 : 1;

    for (const [rowIndex, row] of trimmedDataRows.entries()) {
      const rowNumber = dataStartRowNumber + rowIndex;

      if (this.isSpreadsheetRowEmpty(row)) {
        emptyRowIndices.push(rowNumber);
        continue;
      }

      const normalizedKey = row
        .map((cell) => cell.trim().replaceAll(/\s+/g, " ").toLowerCase())
        .join("|");

      if (seen.has(normalizedKey)) {
        duplicateRowPairs.push({
          row: rowNumber,
          duplicateOf: seen.get(normalizedKey) || rowNumber,
        });
      } else {
        seen.set(normalizedKey, rowNumber);
      }

      for (const [colIndex, cell] of row.entries()) {
        if (
          typeof cell === "string" &&
          /\s{2,}/.test(cell) &&
          doubleSpaceCells.length < 10
        ) {
          doubleSpaceCells.push({
            row: rowNumber,
            column: this.columnIndexToLetter(colIndex),
            value: cell,
          });
        }
      }
    }

    const departmentColumns = headers
      .map((name, index) => ({ index, name }))
      .filter((col) => /department|dept/i.test(col.name));

    const hasEmptyHeaders = headers.some(
      (header) => header.trim().length === 0,
    );

    const columnWidths = Array.isArray(worksheet["!cols"])
      ? worksheet["!cols"].map((col) => {
          if (!col) return null;
          const width = (col as { wch?: number }).wch;
          if (typeof width === "number") return width;
          const wpx = (col as { wpx?: number }).wpx;
          return typeof wpx === "number" ? Math.round(wpx / 7) : null;
        })
      : undefined;

    const maxCellLengths: number[] = [];
    const rowsForLengths =
      headerRowIndex >= 0 ? [headers, ...trimmedDataRows] : trimmedDataRows;

    for (const row of rowsForLengths) {
      for (const [colIndex, cell] of row.entries()) {
        const length = cell.trim().length;
        maxCellLengths[colIndex] =
          maxCellLengths[colIndex] === undefined
            ? length
            : Math.max(maxCellLengths[colIndex], length);
      }
    }

    return {
      filename,
      sheetName,
      headers,
      headerRowIndex,
      dataRowCount: trimmedDataRows.length,
      emptyRowIndices,
      duplicateRowPairs,
      doubleSpaceCells,
      departmentColumns,
      hasEmptyHeaders,
      columnWidths,
      maxCellLengths,
    };
  }

  private normalizeSpreadsheetCell(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number") return value.toString();
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Date) return value.toISOString();
    return String(value);
  }

  private isSpreadsheetRowEmpty(row: string[]): boolean {
    return row.every((cell) => cell.trim() === "");
  }

  private identifySpreadsheetCheck(
    rubric: ScoringDto["rubrics"][number],
  ): SpreadsheetCheckDefinition {
    const criteriaText = rubric.criteria
      ?.map((criterion) => criterion.description)
      .join(" ");
    const rawText = `${rubric.rubricQuestion || ""} ${criteriaText || ""}`;
    const combinedText = rawText.toLowerCase();

    if (mentionsFilenameRequirement(rawText)) {
      const expectedFilename = extractExpectedFilenameFromText(rawText);
      if (!expectedFilename) {
        return { type: "unknown" };
      }

      return { type: "filename_match", expectedFilename };
    }

    if (
      /upload|uploaded/.test(combinedText) ||
      /file\s+open|opens/.test(combinedText)
    ) {
      return { type: "file_open" };
    }

    if (/empty\s+row|blank\s+row/.test(combinedText)) {
      return { type: "empty_rows" };
    }

    if (/duplicate/.test(combinedText)) {
      return { type: "duplicates" };
    }

    if (/double\s+space|extra\s+space|multiple\s+spaces/.test(combinedText)) {
      return { type: "double_spaces" };
    }

    if (/spelling|misspell|typo/.test(combinedText)) {
      return { type: "spelling" };
    }

    if (/department/.test(combinedText)) {
      return { type: "department_columns" };
    }

    if (
      /column/.test(combinedText) &&
      /width|widen|expand|visible|truncate|fit/.test(combinedText)
    ) {
      return { type: "column_width" };
    }

    if (/header|column name/.test(combinedText)) {
      return { type: "headers" };
    }

    const rowCountMatch = combinedText.match(/(\d+)\s+(?:data\s+)?rows?/);
    if (rowCountMatch) {
      return { type: "row_count", expectedRowCount: Number(rowCountMatch[1]) };
    }

    return { type: "unknown" };
  }

  private evaluateSpreadsheetCheck(
    check: SpreadsheetCheckDefinition,
    metrics: SpreadsheetMetrics,
  ): SpreadsheetCheckResult {
    const evidence: string[] = [];

    switch (check.type) {
      case "file_open": {
        evidence.push(
          `Workbook "${metrics.filename}" opened with sheet "${metrics.sheetName}".`,
        );
        return { status: "full", evidence };
      }
      case "filename_match": {
        if (!check.expectedFilename) {
          evidence.push(
            "Filename requirement detected but expected filename could not be parsed from the rubric.",
          );
          return { status: "unknown", evidence };
        }

        evidence.push(
          `Uploaded filename: "${metrics.filename}". Expected filename: "${check.expectedFilename}".`,
        );

        return filenamesMatch(metrics.filename, check.expectedFilename)
          ? { status: "full", evidence }
          : { status: "none", evidence };
      }
      case "headers": {
        if (metrics.headerRowIndex < 0) {
          evidence.push("No header row detected.");
          return { status: "none", evidence };
        }
        if (metrics.hasEmptyHeaders) {
          evidence.push("One or more header cells are blank.");
          return { status: "none", evidence };
        }
        evidence.push(
          `Header row detected at row ${metrics.headerRowIndex + 1} with ${
            metrics.headers.length
          } columns.`,
        );
        return { status: "full", evidence };
      }
      case "empty_rows": {
        if (metrics.dataRowCount === 0) {
          evidence.push("No data rows detected.");
          return { status: "none", evidence };
        }
        if (metrics.emptyRowIndices.length === 0) {
          evidence.push(
            `No empty rows found in ${metrics.dataRowCount} data rows.`,
          );
          return { status: "full", evidence };
        }
        const sample = metrics.emptyRowIndices.slice(0, 5).join(", ");
        evidence.push(
          `Empty rows found at rows: ${sample}${
            metrics.emptyRowIndices.length > 5
              ? " (additional rows omitted)"
              : ""
          }.`,
        );
        return { status: "none", evidence };
      }
      case "duplicates": {
        if (metrics.dataRowCount === 0) {
          evidence.push("No data rows detected.");
          return { status: "none", evidence };
        }
        if (metrics.duplicateRowPairs.length === 0) {
          evidence.push("No duplicate rows detected.");
          return { status: "full", evidence };
        }
        const samplePairs = metrics.duplicateRowPairs
          .slice(0, 3)
          .map((pair) => `row ${pair.row} duplicates row ${pair.duplicateOf}`)
          .join("; ");
        evidence.push(
          `Duplicate rows detected (${metrics.duplicateRowPairs.length} total): ${samplePairs}.`,
        );
        return { status: "none", evidence };
      }
      case "double_spaces": {
        if (metrics.doubleSpaceCells.length === 0) {
          evidence.push("No double spaces detected in cell values.");
          return { status: "full", evidence };
        }
        const sampleCells = metrics.doubleSpaceCells
          .slice(0, 5)
          .map((cell) => `${cell.column}${cell.row}`)
          .join(", ");
        evidence.push(
          `Double spaces found in ${metrics.doubleSpaceCells.length} cell(s) (examples: ${sampleCells}).`,
        );
        return { status: "partial", evidence };
      }
      case "department_columns": {
        if (
          metrics.departmentColumns.length === 1 &&
          !metrics.hasEmptyHeaders
        ) {
          evidence.push(
            `Department column detected: "${metrics.departmentColumns[0].name}".`,
          );
          return { status: "full", evidence };
        }
        if (metrics.departmentColumns.length === 0) {
          evidence.push("No department column detected in headers.");
        } else {
          evidence.push(
            `Multiple department columns detected: ${metrics.departmentColumns
              .map((col) => `"${col.name}"`)
              .join(", ")}.`,
          );
        }
        if (metrics.hasEmptyHeaders) {
          evidence.push("One or more header cells are blank.");
        }
        return { status: "none", evidence };
      }
      case "column_width": {
        evidence.push(
          "Column width is a display setting and cannot be reliably auto-graded.",
        );
        return { status: "unknown", evidence };
      }
      case "spelling": {
        evidence.push(
          "Automated spelling verification is not available for this submission.",
        );
        return { status: "unknown", evidence };
      }
      case "row_count": {
        if (check.expectedRowCount === undefined) {
          evidence.push("Expected row count not specified in rubric.");
          return { status: "unknown", evidence };
        }
        if (metrics.dataRowCount === check.expectedRowCount) {
          evidence.push(
            `Detected ${metrics.dataRowCount} data rows (expected ${check.expectedRowCount}).`,
          );
          return { status: "full", evidence };
        }
        evidence.push(
          `Detected ${metrics.dataRowCount} data rows (expected ${check.expectedRowCount}).`,
        );
        return { status: "none", evidence };
      }

      default: {
        evidence.push("No deterministic check available for this criterion.");
        return { status: "unknown", evidence };
      }
    }
  }

  private selectPointsForStatus(
    criteria: ScoringDto["rubrics"][number]["criteria"],
    status: "full" | "partial" | "none" | "unknown",
  ): {
    points: number;
    criterion?: ScoringDto["rubrics"][number]["criteria"][number];
  } {
    if (!criteria || criteria.length === 0) {
      return { points: 0 };
    }

    const sorted = [...criteria].sort((a, b) => a.points - b.points);
    const minPoints = sorted[0]?.points ?? 0;
    const maxPoints = sorted.at(-1)?.points ?? 0;

    let selectedPoints = maxPoints;
    switch (status) {
      case "none": {
        selectedPoints = minPoints;

        break;
      }
      case "partial": {
        selectedPoints =
          sorted.length <= 2
            ? minPoints
            : sorted[Math.floor((sorted.length - 1) / 2)]?.points;

        break;
      }
      case "unknown": {
        selectedPoints = maxPoints;

        break;
      }
    }

    const criterion = this.pickCriterionByStatus(
      criteria,
      selectedPoints,
      status,
    );

    return { points: selectedPoints, criterion };
  }

  private pickCriterionByStatus(
    criteria: ScoringDto["rubrics"][number]["criteria"],
    points: number,
    status: "full" | "partial" | "none" | "unknown",
  ): ScoringDto["rubrics"][number]["criteria"][number] | undefined {
    const matching = criteria.filter(
      (criterion) => criterion.points === points,
    );
    if (matching.length === 0) return undefined;
    if (matching.length === 1) return matching[0];

    const statusHints: Record<string, RegExp> = {
      full: /yes|all|complete|correct|fully|meets|no issues/i,
      partial: /partial|some|minor|few|mostly|part/i,
      none: /no|not|missing|none|fails/i,
      unknown: /manual|review|unknown/i,
    };

    const hint = statusHints[status];
    const hinted = matching.find((criterion) =>
      hint?.test(criterion.description),
    );
    return hinted || matching[0];
  }

  private buildSpreadsheetFeedback(
    question: string,
    maxTotalPoints: number,
    metrics: SpreadsheetMetrics,
    evaluations: SpreadsheetRubricEvaluation[],
  ): {
    feedback: string;
    analysis: string;
    evaluation: string;
    explanation: string;
    guidance: string;
  } {
    const manualCriteria = evaluations
      .filter((evaluation) => evaluation.manualReviewRequired)
      .map((evaluation) => evaluation.rubricQuestion);

    const feedback =
      manualCriteria.length > 0
        ? `Automated spreadsheet checks completed. ${
            manualCriteria.length
          } rubric item(s) require manual review: ${manualCriteria.join(", ")}.`
        : "Automated spreadsheet checks completed based on deterministic validation.";

    const analysis = [
      `Question: ${question}`,
      `Sheet "${metrics.sheetName}" analyzed from ${metrics.filename}.`,
      `Data rows: ${metrics.dataRowCount}.`,
      `Columns: ${metrics.headers.length}.`,
      `Empty rows: ${metrics.emptyRowIndices.length}.`,
      `Duplicate rows: ${metrics.duplicateRowPairs.length}.`,
      `Double-space cells: ${metrics.doubleSpaceCells.length}.`,
      `Department columns: ${metrics.departmentColumns.length}.`,
      `Auto-graded points: ${evaluations.reduce(
        (sum, evaluation) => sum + evaluation.pointsAwarded,
        0,
      )}/${maxTotalPoints}.`,
    ].join(" ");

    const evaluation = evaluations
      .map(
        (evaluation) =>
          `- ${evaluation.rubricQuestion}: ${evaluation.pointsAwarded}/${evaluation.maxPoints} (${evaluation.status})`,
      )
      .join("\n");

    const explanation = evaluations
      .map((evaluation) => {
        const evidenceText = evaluation.evidence.join(" ");
        return `- ${evaluation.rubricQuestion}: ${evidenceText}`;
      })
      .join("\n");

    const guidanceParts: string[] = [];

    if (metrics.emptyRowIndices.length > 0) {
      guidanceParts.push(
        `Remove empty rows (examples: ${metrics.emptyRowIndices
          .slice(0, 5)
          .join(", ")}).`,
      );
    }
    if (metrics.duplicateRowPairs.length > 0) {
      const samplePairs = metrics.duplicateRowPairs
        .slice(0, 3)
        .map((pair) => `row ${pair.row} duplicates row ${pair.duplicateOf}`)
        .join("; ");
      guidanceParts.push(`Remove duplicate rows (examples: ${samplePairs}).`);
    }
    if (metrics.doubleSpaceCells.length > 0) {
      const sampleCells = metrics.doubleSpaceCells
        .slice(0, 5)
        .map((cell) => `${cell.column}${cell.row}`)
        .join(", ");
      guidanceParts.push(`Fix double spaces in cells such as ${sampleCells}.`);
    }
    if (metrics.departmentColumns.length !== 1 || metrics.hasEmptyHeaders) {
      guidanceParts.push(
        "Ensure there is a single Department column and remove blank header columns.",
      );
    }
    if (manualCriteria.length > 0) {
      guidanceParts.push(
        `Manual review required for: ${manualCriteria.join(", ")}.`,
      );
    }

    const guidance =
      guidanceParts.length > 0
        ? guidanceParts.join(" ")
        : "No changes needed based on automated checks.";

    return { feedback, analysis, evaluation, explanation, guidance };
  }

  private columnIndexToLetter(index: number): string {
    let dividend = index + 1;
    let columnName = "";
    while (dividend > 0) {
      const modulo = (dividend - 1) % 26;
      columnName = String.fromCodePoint(65 + modulo) + columnName;
      dividend = Math.floor((dividend - modulo) / 26);
    }
    return columnName;
  }

  private estimateTokensForFileGrading(
    question: string,
    extractedContent: string,
    scoringCriteria: ScoringDto,
    modelKey: string,
  ): number {
    const criteriaText = this.safeStringify(scoringCriteria);
    const estimateText = `${question}\n${criteriaText}\n${extractedContent}`;
    return this.tokenCounter.countTokens(estimateText, modelKey);
  }

  private async summarizeFilesForGrading(
    learnerResponse: LearnerFileUpload[],
    question: string,
    scoringCriteria: ScoringDto,
    assignmentId: number,
    language: string,
    modelKey: string,
    safeTokenLimit: number,
  ): Promise<Array<{ filename: string; summary: string }>> {
    const summaries: Array<{ filename: string; summary: string }> = [];
    const chunkTokenLimit =
      this.contentSummarization.getChunkTokenLimit(safeTokenLimit);
    const criteriaText = this.contentSummarization.truncateToTokenLimit(
      this.safeStringify(scoringCriteria),
      2000,
      modelKey,
    );

    for (const file of learnerResponse) {
      const content = this.getFileContentForPrompt(file);
      if (!content.trim()) {
        summaries.push({
          filename: file.filename,
          summary: "No textual content available in this file.",
        });
        continue;
      }

      const chunks = this.contentSummarization.splitTextIntoChunks(
        content,
        chunkTokenLimit,
        modelKey,
      );
      const chunkSummaries: string[] = [];

      for (const chunk of chunks) {
        try {
          const summary = await this.contentSummarization.summarizeChunk({
            chunk,
            label: file.filename,
            questionText: question,
            criteriaText,
            modelKey,
            assignmentId,
            usageType: AIUsageType.ASSIGNMENT_GRADING,
            feature: "file_grading",
            language,
          });
          chunkSummaries.push(summary.trim());
        } catch (error) {
          this.logger.warn(
            `Chunk summarization failed for ${file.filename}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          chunkSummaries.push(
            this.contentSummarization.truncateToTokenLimit(
              chunk,
              1200,
              modelKey,
            ),
          );
        }
      }

      let summaryText = chunkSummaries.filter(Boolean).join("\n");

      const perFileLimit = Math.max(1500, Math.floor(safeTokenLimit * 0.1));
      if (this.tokenCounter.countTokens(summaryText, modelKey) > perFileLimit) {
        summaryText = await this.contentSummarization.compressSummary({
          summary: summaryText,
          label: file.filename,
          questionText: question,
          criteriaText,
          modelKey,
          assignmentId,
          usageType: AIUsageType.ASSIGNMENT_GRADING,
          feature: "file_grading",
          targetTokens: perFileLimit,
          language,
        });
      }

      summaries.push({
        filename: file.filename,
        summary: summaryText.trim(),
      });
    }

    const combinedPrompt = this.buildFileGradingPrompt({
      template: this.getTemplateForFileType(ResponseType.OTHER, true),
      question,
      files: summaries,
      maxTotalPoints: 1,
      scoringCriteriaType: "SUMMARY_ONLY",
      scoringCriteria,
      responseType: ResponseType.OTHER,
      language,
      formatInstructions: "{}",
    });

    const combinedPromptText = await combinedPrompt.format({});
    const combinedTokens = this.tokenCounter.countTokens(
      combinedPromptText,
      modelKey,
    );

    if (combinedTokens > safeTokenLimit) {
      const mergedSummary = await this.contentSummarization.compressSummary({
        summary: summaries
          .map((summary) => `${summary.filename}:\n${summary.summary}`)
          .join("\n\n"),
        label: "combined",
        questionText: question,
        criteriaText,
        modelKey,
        assignmentId,
        usageType: AIUsageType.ASSIGNMENT_GRADING,
        feature: "file_grading",
        targetTokens: Math.max(3000, Math.floor(safeTokenLimit * 0.3)),
        language,
      });
      const mergedFiles = [
        {
          filename: "combined",
          summary: mergedSummary.trim(),
        },
      ];

      const mergedPrompt = this.buildFileGradingPrompt({
        template: this.getTemplateForFileType(ResponseType.OTHER, true),
        question,
        files: mergedFiles,
        maxTotalPoints: 1,
        scoringCriteriaType: "SUMMARY_ONLY",
        scoringCriteria,
        responseType: ResponseType.OTHER,
        language,
        formatInstructions: "{}",
      });
      const mergedPromptText = await mergedPrompt.format({});
      const mergedTokens = this.tokenCounter.countTokens(
        mergedPromptText,
        modelKey,
      );

      if (mergedTokens > safeTokenLimit) {
        const trimmedSummary = this.contentSummarization.truncateToTokenLimit(
          mergedSummary,
          Math.max(2000, Math.floor(safeTokenLimit * 0.2)),
          modelKey,
        );
        return [
          {
            filename: "combined",
            summary: trimmedSummary.trim(),
          },
        ];
      }

      return mergedFiles;
    }

    return summaries;
  }

  private safeStringify(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value ?? "");
    }
  }

  /**
   * Grade with evidence-based approach using structured content
   * This is the PREFERRED method for criterion-based grading
   */
  private async gradeWithEvidenceBasedApproach(
    learnerResponse: LearnerFileUpload[],
    question: string,
    maxTotalPoints: number,
    scoringCriteria: ScoringDto,
    assignmentId: number,
    language: string | undefined,
    rubricMaxPoints: { rubricQuestion: string; maxPoints: number }[],
    judgeFeedback?: string,
  ): Promise<FileBasedQuestionResponseModel> {
    try {
      // Mirror the routing gate's eligibility check so a source-code file that
      // happens to carry structuredContent is never graded in place of the
      // intended document in a mixed submission.
      const structuredFile = learnerResponse.find((file) =>
        this.isEvidenceBasedEligible(file),
      );

      if (!structuredFile || !structuredFile.structuredContent) {
        throw new Error("No structured content found");
      }

      const submission = structuredFile.structuredContent;

      this.logger.info(
        `Evidence-based grading: ${submission.metadata.blockCount} blocks, ${submission.metadata.pageCount} pages`,
      );

      this.logger.info("About to convert scoring criteria", {
        hasScoringCriteria: !!scoringCriteria,
        scoringCriteriaType: typeof scoringCriteria,
        scoringCriteriaKeys: scoringCriteria
          ? Object.keys(scoringCriteria)
          : [],
        hasRubrics: scoringCriteria?.rubrics !== undefined,
        rubricsType: scoringCriteria?.rubrics
          ? typeof scoringCriteria.rubrics
          : "undefined",
        scoringCriteriaJSON: JSON.stringify(scoringCriteria).slice(0, 500),
      });

      const criteria = this.convertToRubricCriteria(scoringCriteria);

      if (criteria.length === 0) {
        throw new Error("No valid criteria found for evidence-based grading");
      }

      const result = await this.evidenceBasedGrading.gradeSubmission(
        submission,
        criteria,
        question,
        assignmentId,
        language || "en",
        judgeFeedback,
      );

      this.logger.info(
        `Evidence-based grading complete: ${result.totalPoints}/${result.maxPossiblePoints} points, ` +
          `criteriaResults=${result.criteriaResults.length}, ` +
          `totalEvidence=${result.criteriaResults.reduce(
            (sum, c) => sum + c.evidence.length,
            0,
          )}`,
      );

      let annotatedPdfUrl: string | null = null;
      const highlighting = this.normalizeHighlighting(result.highlighting);
      if (highlighting) {
        this.logger.info(
          "Highlighting data generated from evidence-based grading",
          {
            hasHighlighting: true,
            pageCount: Object.keys(highlighting.pages).length,
            blockHighlightCount: Object.keys(highlighting.blockHighlights || {})
              .length,
          },
        );

        annotatedPdfUrl = await this.generateAnnotatedPdf(
          learnerResponse,
          highlighting,
          assignmentId,
        );

        this.logger.info("Annotated PDF generation result", {
          annotatedPdfUrl: annotatedPdfUrl
            ? "Generated successfully"
            : "Failed",
          urlLength: annotatedPdfUrl?.length || 0,
        });
      } else {
        this.logger.warn(
          "No highlighting data generated from evidence-based grading",
        );
      }

      return this.convertEvidenceResultToFileBasedModel(
        result,
        maxTotalPoints,
        annotatedPdfUrl,
        highlighting ?? undefined,
      );
    } catch (error) {
      this.logger.error(
        `Evidence-based grading failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      this.logger.warn(
        "Evidence-based grading failed - assigning minimum points",
      );
      return this.createMinimumEvidenceResponse(
        maxTotalPoints,
        scoringCriteria,
      );
    }
  }

  /**
   * Convert scoring criteria to RubricCriterion format
   */
  private convertToRubricCriteria(
    scoringCriteria?: ScoringDto,
  ): RubricCriterion[] {
    const criteria: RubricCriterion[] = [];

    this.logger.info("Converting scoring criteria to RubricCriterion format", {
      hasScoringCriteria: !!scoringCriteria,
      hasRubrics: !!scoringCriteria?.rubrics,
      scoringCriteriaKeys: scoringCriteria ? Object.keys(scoringCriteria) : [],
      rubricsType: scoringCriteria?.rubrics
        ? typeof scoringCriteria.rubrics
        : "undefined",
      rubricsIsArray: Array.isArray(scoringCriteria?.rubrics),
      rubricsLength: Array.isArray(scoringCriteria?.rubrics)
        ? scoringCriteria.rubrics.length
        : "N/A",
      firstRubricKeys: scoringCriteria?.rubrics?.[0]
        ? Object.keys(scoringCriteria.rubrics[0])
        : [],
    });

    if (!scoringCriteria || !scoringCriteria.rubrics) {
      this.logger.warn("No scoring criteria or rubrics found");
      return criteria;
    }

    type RubricInput = ScoringDto["rubrics"][number] & { description?: string };
    type CriterionInput = RubricInput["criteria"][number] & {
      criterion?: string;
    };

    const rubrics: RubricInput[] = Array.isArray(scoringCriteria.rubrics)
      ? scoringCriteria.rubrics
      : [scoringCriteria.rubrics];

    for (const [index, rubric] of rubrics.entries()) {
      this.logger.info(`Processing rubric ${index}`, {
        rubricKeys: Object.keys(rubric),
        hasCriteria: !!rubric.criteria,
        criteriaType: typeof rubric.criteria,
        criteriaIsArray: Array.isArray(rubric.criteria),
        criteriaLength: Array.isArray(rubric.criteria)
          ? rubric.criteria.length
          : "N/A",
        rubricQuestion: rubric.rubricQuestion || "N/A",
      });

      if (!rubric.criteria || !Array.isArray(rubric.criteria)) {
        this.logger.warn(`Skipping rubric ${index} - no valid criteria array`, {
          hasCriteria: !!rubric.criteria,
          criteriaType: typeof rubric.criteria,
        });
        continue;
      }

      const maxPoints = Math.max(
        ...rubric.criteria.map((criterion) => criterion.points || 0),
      );

      criteria.push({
        id: `criterion_${index}`,
        rubricQuestion: rubric.rubricQuestion || `Criterion ${index + 1}`,
        description: rubric.description || "",
        criteria: rubric.criteria.map((criterion: CriterionInput) => ({
          description: criterion.description || criterion.criterion || "",
          points: criterion.points || 0,
        })),
        maxPoints,
      });
    }

    this.logger.info("Rubric conversion complete", {
      totalRubricsProcessed: rubrics.length,
      validCriteriaCreated: criteria.length,
      criteriaIds: criteria.map((c) => c.id),
    });

    return criteria;
  }

  /**
   * Convert evidence-based result to FileBasedQuestionResponseModel
   */
  private convertEvidenceResultToFileBasedModel(
    result: EvidenceBasedGradingResult,
    maxTotalPoints: number,
    annotatedPdfUrl?: string | null,
    normalizedHighlighting?: FileHighlighting,
  ): FileBasedQuestionResponseModel {
    const rubricScores: RubricScore[] = result.criteriaResults.map(
      (criterion) => ({
        rubricQuestion: criterion.rubricQuestion,
        pointsAwarded: criterion.pointsAwarded,
        maxPoints: criterion.maxPoints,
        justification: criterion.rationale,
        evidence: criterion.evidence.map(
          (citation) =>
            `p${citation.page}:${citation.blockId} ${citation.quote}`,
        ),
        status:
          criterion.decision === "meets"
            ? "full"
            : criterion.decision === "partially_meets"
              ? "partial"
              : "none",
      }),
    );

    const finalPoints = Math.min(result.totalPoints, maxTotalPoints);

    if (result.totalPoints > maxTotalPoints) {
      this.logger.warn(
        `Evidence-based grading awarded ${result.totalPoints}, capping to ${maxTotalPoints}`,
      );
    }

    const summaryText = result.feedback.summary || "";

    const analysisMatch = summaryText.match(
      /\*\*Analysis:\*\*\s*([\S\s]+?)(?=\n\n\*\*|$)/,
    );
    const evaluationMatch = summaryText.match(
      /\*\*Evaluation:\*\*\s*([\S\s]+?)(?=\n\n\*\*|$)/,
    );
    const explanationMatch = summaryText.match(
      /\*\*Explanation:\*\*\s*([\S\s]+?)(?=\n\n\*\*|$)/,
    );
    const guidanceMatch = summaryText.match(
      /\*\*Guidance:\*\*\s*([\S\s]+?)(?=\n\n\*\*|$)/,
    );

    const analysis = analysisMatch ? analysisMatch[1].trim() : "";
    const evaluation = evaluationMatch ? evaluationMatch[1].trim() : "";
    const explanation = explanationMatch ? explanationMatch[1].trim() : "";
    const guidance = guidanceMatch ? guidanceMatch[1].trim() : "";

    const overallAssessment = summaryText
      .split("**Detailed Breakdown:**")[0]
      .trim();

    const feedbackText =
      `${overallAssessment}\n\n` +
      (result.feedback.strengths && result.feedback.strengths.length > 0
        ? `**Strengths:**\n${result.feedback.strengths
            .map((s: string) => `- ${s}`)
            .join("\n")}\n\n`
        : "") +
      (result.feedback.improvements && result.feedback.improvements.length > 0
        ? `**Areas for Improvement:**\n${result.feedback.improvements
            .map((index: string) => `- ${index}`)
            .join("\n")}`
        : "");

    const highlighting: FileHighlighting | null = result.highlighting;

    this.logger.info(
      "Converting evidence result to FileBasedQuestionResponseModel",
      {
        hasHighlighting: !!(normalizedHighlighting || highlighting),
        hasAnnotatedPdfUrl: !!annotatedPdfUrl,
        highlightingPages: Object.keys(
          (normalizedHighlighting || highlighting)?.pages || {},
        ).length,
        annotatedPdfUrlLength: annotatedPdfUrl?.length || 0,
      },
    );

    const metadata =
      result.metadata && "auditLog" in result.metadata
        ? {
            gradingAudit: (result.metadata as { auditLog?: unknown }).auditLog,
            gradingModel: result.metadata.modelUsed,
            determinismChecksum: result.metadata.determinismChecksum,
          }
        : undefined;

    const model = new FileBasedQuestionResponseModel(
      finalPoints,
      feedbackText,
      analysis,
      evaluation,
      explanation,
      guidance,
      rubricScores,
      normalizedHighlighting || highlighting || undefined,
      annotatedPdfUrl || undefined,
      metadata,
    );

    this.logger.info("FileBasedQuestionResponseModel created", {
      hasHighlighting: !!highlighting,
      hasAnnotatedPdfUrl: !!annotatedPdfUrl,
    });

    return model;
  }

  /**
   * Normalize highlighting objects so that Maps (from some serializers) are converted
   * to plain JSON-ready Records before persisting or returning to clients.
   */
  private normalizeHighlighting(
    highlighting: FileHighlighting | null,
  ): FileHighlighting | null {
    if (!highlighting) return null;

    const hasMaps =
      highlighting.pages instanceof Map ||
      highlighting.blockHighlights instanceof Map;

    if (hasMaps) {
      return serializeFileHighlighting(
        highlighting as unknown as {
          filename: string;
          pages: Map<number, any>;
          blockHighlights: Map<string, any>;
        },
      );
    }

    return {
      filename: highlighting.filename,
      pages: { ...highlighting.pages },
      blockHighlights: { ...highlighting.blockHighlights },
    };
  }

  /**
   * Generate and upload annotated PDF with AI feedback
   * @param learnerResponse The learner's file response
   * @param highlighting Highlighting data from grading
   * @param assignmentId Assignment ID for COS path
   * @param studentName Optional student name
   * @returns URL of the annotated PDF
   */
  private async generateAnnotatedPdf(
    learnerResponse: LearnerFileUpload[],
    highlighting: FileHighlighting,
    assignmentId: number,
    studentName?: string,
  ): Promise<string | null> {
    try {
      const pdfFile = learnerResponse.find((file) =>
        file.filename?.toLowerCase().endsWith(".pdf"),
      );

      if (!pdfFile) {
        this.logger.warn("No PDF file found for annotation");
        return null;
      }

      let pdfBuffer: Buffer;

      if (pdfFile.bucket && pdfFile.key) {
        this.logger.debug(`Downloading PDF from COS: ${pdfFile.key}`);
        const pdfData = await this.s3Service.getObject({
          Bucket: pdfFile.bucket,
          Key: pdfFile.key,
        });
        const pdfBody = pdfData.Body;
        if (!pdfBody) {
          this.logger.warn("COS object has no body");
          return null;
        }

        if (Buffer.isBuffer(pdfBody)) {
          pdfBuffer = pdfBody;
        } else if (pdfBody instanceof Uint8Array) {
          pdfBuffer = Buffer.from(pdfBody);
        } else if (
          typeof (
            pdfBody as { transformToByteArray?: () => Promise<Uint8Array> }
          ).transformToByteArray === "function"
        ) {
          const bytes = await (
            pdfBody as { transformToByteArray: () => Promise<Uint8Array> }
          ).transformToByteArray();
          pdfBuffer = Buffer.from(bytes);
        } else {
          const chunks: Uint8Array[] = [];
          const stream = pdfBody as NodeJS.ReadableStream;
          pdfBuffer = await new Promise((resolve, reject) => {
            stream.on("data", (chunk) =>
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
            );
            stream.on("end", () => resolve(Buffer.concat(chunks)));
            stream.on("error", reject);
          });
        }
      } else if (pdfFile.fileUrl) {
        this.logger.debug(`Downloading PDF from URL: ${pdfFile.fileUrl}`);
        const response = await axios.get(pdfFile.fileUrl, {
          responseType: "arraybuffer",
        });
        const responseData = response.data as ArrayBuffer;
        pdfBuffer = Buffer.from(responseData);
      } else {
        this.logger.warn("PDF file has no accessible source");
        return null;
      }

      this.logger.info("Annotating PDF with AI feedback");
      const annotatedPdfBuffer = await this.pdfAnnotationService.annotatePdf(
        pdfBuffer,
        highlighting,
        studentName,
      );

      const originalFilename = pdfFile.filename || "submission.pdf";
      const nameWithoutExtension = originalFilename.replace(/\.pdf$/i, "");
      const annotatedFilename = `${nameWithoutExtension}_feedback.pdf`;

      const uploadKey = `assignments/${assignmentId}/feedback/${Date.now()}_${annotatedFilename}`;
      const bucket = pdfFile.bucket || this.s3Service.getBucketName("learner");

      this.logger.debug(`Uploading annotated PDF to COS: ${uploadKey}`);
      await this.s3Service.putObject({
        Bucket: bucket,
        Key: uploadKey,
        Body: annotatedPdfBuffer,
        ContentType: "application/pdf",
      });

      const presignedUrl = await this.s3Service.getSignedUrl("getObject", {
        Bucket: bucket,
        Key: uploadKey,
        Expires: 3600 * 24 * 7,
      });

      this.logger.info(
        `Annotated PDF created successfully: ${annotatedFilename}`,
      );
      return presignedUrl;
    } catch (error) {
      this.logger.error(
        `Failed to generate annotated PDF: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }
}
