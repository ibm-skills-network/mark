import { PromptTemplate } from "@langchain/core/prompts";
import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { AIUsageType, ResponseType } from "@prisma/client";
import axios from "axios";
import { StructuredOutputParser } from "langchain/output_parsers";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { ScoringDto } from "src/api/assignment/dto/update.questions.request.dto";
import { LearnerFileUpload } from "src/api/attempt/common/interfaces/attempt.interface";
import { PdfAnnotationService } from "src/api/attempt/services/pdf-annotation.service";
import {
  CanonicalSubmission,
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
import { z } from "zod";
import { IModerationService } from "../../../core/interfaces/moderation.interface";
import { IPromptProcessor } from "../../../core/interfaces/prompt-processor.interface";
import { ITokenCounter } from "../../../core/interfaces/token-counter.interface";
import { LLMResolverService } from "../../../core/services/llm-resolver.service";
import {
  LLM_RESOLVER_SERVICE,
  MODERATION_SERVICE,
  PROMPT_PROCESSOR,
  TOKEN_COUNTER,
} from "../../../llm.constants";
import { IFileGradingService } from "../interfaces/file-grading.interface";
import {
  EvidenceBasedGradingService,
  RubricCriterion,
} from "./evidence-based-grading.service";

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
  private readonly contextWindowByModel: Record<string, number> = {
    "gpt-5-mini": 128_000,
    "gpt-5o-mini": 128_000,
    "gpt-5": 128_000,
    "gpt-4o-mini": 128_000,
    "gpt-4o": 128_000,
    "gpt-4.1-mini": 128_000,
    "gpt-4.1": 128_000,
  };
  private readonly defaultContextWindow = 32_000;
  private readonly contextSafetyRatio = 0.8;
  private readonly minimumChunkTokens = 4000;
  private readonly maximumChunkTokens = 20_000;

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

    const hasStructuredContent = learnerResponse.some(
      (file) => file.structuredContent,
    );

    this.logger.info("Checking for evidence-based grading trigger", {
      hasStructuredContent,
      scoringCriteriaType,
      filesCount: learnerResponse.length,
      filesWithStructuredContent: learnerResponse.filter(
        (file) => file.structuredContent,
      ).length,
    });

    if (hasStructuredContent) {
      this.logger.info("Using evidence-based grading with structured content");
      const model = await this.gradeWithEvidenceBasedApproach(
        learnerResponse,
        question,
        maxTotalPoints,
        scoringCriteria,
        assignmentId,
        language,
        rubricMaxPoints,
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
      const safeTokenLimit = this.getSafeContextLimit(selectedModel);

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

  private getSafeContextLimit(modelKey: string): number {
    const normalized = modelKey.toLowerCase();
    const matchKey = Object.keys(this.contextWindowByModel).find((key) =>
      normalized.includes(key),
    );
    const limit = matchKey
      ? this.contextWindowByModel[matchKey]
      : this.defaultContextWindow;
    return Math.floor(limit * this.contextSafetyRatio);
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
    const chunkTokenLimit = Math.max(
      this.minimumChunkTokens,
      Math.min(this.maximumChunkTokens, Math.floor(safeTokenLimit * 0.2)),
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

      const chunks = this.splitTextIntoChunks(
        content,
        chunkTokenLimit,
        modelKey,
      );
      const chunkSummaries: string[] = [];

      for (const chunk of chunks) {
        try {
          const summary = await this.summarizeChunkForGrading(
            chunk,
            file.filename,
            question,
            scoringCriteria,
            assignmentId,
            language,
            modelKey,
          );
          chunkSummaries.push(summary.trim());
        } catch (error) {
          this.logger.warn(
            `Chunk summarization failed for ${file.filename}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          chunkSummaries.push(this.truncateToTokenLimit(chunk, 1200, modelKey));
        }
      }

      let summaryText = chunkSummaries.filter(Boolean).join("\n");

      const perFileLimit = Math.max(1500, Math.floor(safeTokenLimit * 0.1));
      if (this.tokenCounter.countTokens(summaryText, modelKey) > perFileLimit) {
        summaryText = await this.compressSummary(
          summaryText,
          question,
          scoringCriteria,
          assignmentId,
          language,
          modelKey,
          perFileLimit,
        );
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
      const mergedSummary = await this.compressSummary(
        summaries
          .map((summary) => `${summary.filename}:\n${summary.summary}`)
          .join("\n\n"),
        question,
        scoringCriteria,
        assignmentId,
        language,
        modelKey,
        Math.max(3000, Math.floor(safeTokenLimit * 0.3)),
      );
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
        const trimmedSummary = this.truncateToTokenLimit(
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

  private splitTextIntoChunks(
    text: string,
    maxTokens: number,
    modelKey: string,
  ): string[] {
    const chunks: string[] = [];
    const approxCharsPerToken = 4;
    const maxChars = Math.max(1000, maxTokens * approxCharsPerToken);
    let start = 0;

    while (start < text.length) {
      let end = Math.min(text.length, start + maxChars);
      let chunk = text.slice(start, end);
      let tokenCount = this.tokenCounter.countTokens(chunk, modelKey);

      if (tokenCount > maxTokens) {
        const ratio = Math.max(0.2, maxTokens / tokenCount);
        end = Math.min(text.length, start + Math.floor(chunk.length * ratio));
        chunk = text.slice(start, end);
        tokenCount = this.tokenCounter.countTokens(chunk, modelKey);
      }

      if (chunk.length === 0) {
        break;
      }

      chunks.push(chunk);
      start = end;
    }

    return chunks;
  }

  private async summarizeChunkForGrading(
    chunk: string,
    filename: string,
    question: string,
    scoringCriteria: ScoringDto,
    assignmentId: number,
    language: string,
    modelKey: string,
  ): Promise<string> {
    const prompt = new PromptTemplate({
      template: `You are condensing a learner submission chunk to help grading.

QUESTION:
{question}

SCORING CRITERIA:
{scoring_criteria}

FILE: {filename}

CONTENT CHUNK:
{chunk}

LANGUAGE: {language}

Write a concise summary (max 200 words) highlighting evidence relevant to the rubric and any missing elements. Use short bullet points.`,
      inputVariables: [],
      partialVariables: {
        question: () => question,
        scoring_criteria: () =>
          this.truncateToTokenLimit(
            this.safeStringify(scoringCriteria),
            2000,
            modelKey,
          ),
        filename: () => filename,
        chunk: () => chunk,
        language: () => language ?? "en",
      },
    });

    return await this.promptProcessor.processPromptForFeature(
      prompt,
      assignmentId,
      AIUsageType.ASSIGNMENT_GRADING,
      "file_grading",
      modelKey,
    );
  }

  private async compressSummary(
    summaryText: string,
    question: string,
    scoringCriteria: ScoringDto,
    assignmentId: number,
    language: string,
    modelKey: string,
    targetTokens: number,
  ): Promise<string> {
    const cappedSummary = this.truncateToTokenLimit(
      summaryText,
      Math.max(targetTokens * 2, 4000),
      modelKey,
    );
    const prompt = new PromptTemplate({
      template: `You are compressing grading notes into a shorter summary.

QUESTION:
{question}

SCORING CRITERIA:
{scoring_criteria}

NOTES:
{summary}

LANGUAGE: {language}

Return a concise summary (max 300 words) focused on evidence and gaps.`,
      inputVariables: [],
      partialVariables: {
        question: () => question,
        scoring_criteria: () =>
          this.truncateToTokenLimit(
            this.safeStringify(scoringCriteria),
            2000,
            modelKey,
          ),
        summary: () => cappedSummary,
        language: () => language ?? "en",
      },
    });

    try {
      const compressed = await this.promptProcessor.processPromptForFeature(
        prompt,
        assignmentId,
        AIUsageType.ASSIGNMENT_GRADING,
        "file_grading",
        modelKey,
      );

      return this.truncateToTokenLimit(compressed, targetTokens, modelKey);
    } catch (error) {
      this.logger.warn(
        `Summary compression failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.truncateToTokenLimit(summaryText, targetTokens, modelKey);
    }
  }

  private truncateToTokenLimit(
    text: string,
    maxTokens: number,
    modelKey: string,
  ): string {
    if (!text) return "";
    if (this.tokenCounter.countTokens(text, modelKey) <= maxTokens) {
      return text;
    }

    const approxCharsPerToken = 4;
    let end = Math.max(1000, maxTokens * approxCharsPerToken);
    end = Math.min(text.length, end);
    let truncated = text.slice(0, end);

    while (
      truncated.length > 0 &&
      this.tokenCounter.countTokens(truncated, modelKey) > maxTokens
    ) {
      end = Math.floor(end * 0.9);
      truncated = text.slice(0, end);
    }

    return truncated;
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
  ): Promise<FileBasedQuestionResponseModel> {
    try {
      const structuredFile = learnerResponse.find(
        (file) => file.structuredContent,
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

      this.logger.warn("Falling back to standard file grading");
      return this.createFallbackResponse(
        maxTotalPoints,
        "Evidence-based grading failed - using fallback",
        rubricMaxPoints,
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
    const rubricScores = result.criteriaResults.map((criterion) => ({
      rubricQuestion: criterion.rubricQuestion,
      pointsAwarded: criterion.pointsAwarded,
      maxPoints: criterion.maxPoints,
      justification: criterion.rationale,
      evidence: criterion.evidence,
      decision: criterion.decision,
    }));

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
        pdfBuffer = Buffer.isBuffer(pdfBody)
          ? pdfBody
          : Buffer.from(pdfBody as ArrayBuffer);
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

      const presignedUrl = this.s3Service.getSignedUrl("getObject", {
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

  /**
   * Grade files using vision-capable models for direct PDF/image processing
   */
  private async gradeWithVision(
    learnerResponse: LearnerFileUpload[],
    question: string,
    maxTotalPoints: number,
    scoringCriteriaType: string,
    scoringCriteria: ScoringDto,
    responseType: ResponseType,
    assignmentId: number,
    language: string | undefined,
    rubricMaxPoints: { rubricQuestion: string; maxPoints: number }[],
  ): Promise<FileBasedQuestionResponseModel> {
    try {
      const visionFile = learnerResponse.find(
        (file) => file.useVisionMode && file.fileUrl,
      );

      if (!visionFile) {
        throw new Error("No vision mode file found");
      }

      this.logger.info(`Grading PDF using vision mode: ${visionFile.filename}`);

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

      const fileTypeDescriptions: Record<ResponseType, string> = {
        CODE: "code submission",
        REPO: "repository submission",
        ESSAY: "essay submission",
        REPORT: "report submission",
        PRESENTATION: "presentation submission",
        VIDEO: "video submission",
        AUDIO: "audio submission",
        SPREADSHEET: "spreadsheet submission",
        LIVE_RECORDING: "live recording submission",
        IMAGES: "image-based submission",
        OTHER: "document submission",
      };

      const fileTypeContext =
        fileTypeDescriptions[responseType] || fileTypeDescriptions.OTHER;

      const visionPrompt = new PromptTemplate({
        template: `
You are grading a ${fileTypeContext} that has been submitted as a PDF document.

QUESTION: {question}
FILENAME: {filename}
POINTS: {total_points} | TYPE: {scoring_type}
CRITERIA: {scoring_criteria}

IMPORTANT: You are viewing the actual PDF document. Analyze the COMPLETE visual content including:
- All text, formatting, and layout
- Images, diagrams, charts, and tables
- Design and presentation quality
- Overall structure and organization

RUBRIC RULES:
- Select EXACTLY ONE criterion per rubric (no interpolation)
- Award EXACT points from selected criterion
- Total = sum of rubric points (max {total_points})
- Include rubricScores array with: rubricQuestion, pointsAwarded, maxPoints, justification

AEEG APPROACH:
1. ANALYZE: Examine all visual elements, text, structure, and quality
2. EVALUATE: Match submission to each rubric criterion, select best fit
3. EXPLAIN: Justify grade with specific evidence from the PDF
4. GUIDE: Provide actionable improvement suggestions

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

Provide your response as a JSON object with:
- points (total score as rubric sum)
- feedback (overall assessment using learner-focused language)
- analysis (comprehensive examination of the PDF content)
- evaluation (rubric-based scoring with evidence)
- explanation (detailed grade justification with specific examples from the PDF)
- guidance (concrete improvement tips)
- rubricScores array (if CRITERIA_BASED)

AVOID REDUNDANCY: Each field should contain unique information.
Make sure your feedback is concise but thorough.

{format_instructions}
`,
        inputVariables: [],
        partialVariables: {
          question: () => question,
          filename: () => visionFile.filename,
          total_points: () => maxTotalPoints.toString(),
          scoring_type: () => scoringCriteriaType,
          scoring_criteria: () => JSON.stringify(scoringCriteria),
          language: () => language ?? "en",
          format_instructions: () => formatInstructions,
        },
      });

      this.logger.debug(
        `Calling vision LLM with PDF URL: ${visionFile.fileUrl.slice(
          0,
          100,
        )}...`,
      );

      const response = await this.promptProcessor.processPromptWithImage(
        visionPrompt,
        visionFile.fileUrl,
        assignmentId,
        AIUsageType.ASSIGNMENT_GRADING,
        "gpt-4o-mini",
      );

      this.logger.debug(
        `Vision LLM response received, length: ${response.length}`,
      );

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
            `Vision LLM total points (${parsedResponse.points}) doesn't match sum of rubric scores (${calculatedTotalPoints}). Using rubric sum.`,
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
          `Vision LLM awarded ${parsedPoints} points, exceeds maximum of ${maxTotalPoints}. Capping at maximum.`,
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
          `Vision LLM awarded negative points (${parsedPoints}). Setting to 0.`,
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

      this.logger.info(
        `Vision-based grading completed successfully: ${finalModel.points}/${maxTotalPoints}`,
      );

      return finalModel;
    } catch (error) {
      this.logger.error(
        `Error in vision-based grading: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );

      this.logger.warn(
        "Vision grading failed, falling back to standard text-based grading",
      );

      return this.createFallbackResponse(
        maxTotalPoints,
        "Vision-based grading failed - using fallback grading",
        rubricMaxPoints,
      );
    }
  }
}
