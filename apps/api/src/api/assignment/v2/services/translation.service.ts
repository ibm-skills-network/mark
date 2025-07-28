/* eslint-disable unicorn/no-null */
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma, Translation } from "@prisma/client";
import Bottleneck from "bottleneck";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import { PrismaService } from "src/prisma.service";
import {
  getAllLanguageCodes,
  getLanguageNameFromCode,
} from "../../attempt/helper/languages";
import {
  GetAssignmentResponseDto,
  LearnerGetAssignmentResponseDto,
} from "../../dto/get.assignment.response.dto";
import {
  Choice,
  QuestionDto,
  VariantDto,
} from "../../dto/update.questions.request.dto";
import { JobStatusServiceV2 } from "./job-status.service";

interface IExistingTranslation {
  introduction: string;
  instructions: string | null;
  gradingCriteriaOverview: string | null;
  updatedAt: Date;
  id: number;
  assignmentId: number;
  createdAt: Date;
  name: string;
  languageCode: string;
  translatedName: string | null;
  translatedIntroduction: string | null;
  translatedInstructions: string | null;
  translatedGradingCriteriaOverview: string | null;
}

interface ProgressTracker {
  jobId: number;
  totalItems: number;
  completedItems: number;
  currentItemIndex: number;
  startPercentage: number;
  endPercentage: number;
  currentStage: string;
  languageTotal: number;
  languageCompleted: number;
}

interface BatchProcessResult {
  success: number;
  failure: number;
  dropped: number;
}

/**
 * Service for handling translations of assignments, questions, and variants
 * Optimized for performance with parallel processing
 */
@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);
  private readonly languageTranslation: boolean;
  private readonly limiter: Bottleneck;

  private readonly MAX_BATCH_SIZE = 50;
  private readonly CONCURRENCY_LIMIT = 35;
  private readonly MAX_RETRY_ATTEMPTS = 2;
  private readonly RETRY_DELAY_BASE = 200;
  private readonly STATUS_UPDATE_INTERVAL = 10;

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmFacadeService: LlmFacadeService,
    private readonly jobStatusService: JobStatusServiceV2,
  ) {
    this.languageTranslation = process.env.NODE_ENV !== "development";

    this.limiter = new Bottleneck({
      maxConcurrent: 35,
      minTime: 5,
      reservoir: 200,
      reservoirRefreshInterval: 5000,
      reservoirRefreshAmount: 200,
      highWater: 3000,
      strategy: Bottleneck.strategy.OVERFLOW,
      timeout: 45_000,
    });
    setInterval(() => this.checkLimiterHealth(), 30_000);
  }

  /**
   * Process translations in parallel with efficient batching
   * @param items Items to translate
   * @param batchProcessor Function to process each item
   * @param batchSize Optimal batch size
   * @param concurrencyLimit Max number of concurrent batches
   */
  private async processBatchesInParallel<T>(
    items: T[],
    batchProcessor: (item: T) => Promise<boolean>,
    batchSize = this.MAX_BATCH_SIZE,
    concurrencyLimit = this.CONCURRENCY_LIMIT,
  ): Promise<BatchProcessResult> {
    const results: BatchProcessResult = { success: 0, failure: 0, dropped: 0 };
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += batchSize) {
      chunks.push(items.slice(index, index + batchSize));
    }

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];

      const processingPromises = chunk.map((item) =>
        this.limiter
          .schedule({ expiration: 15_000, priority: 5 }, () =>
            batchProcessor(item),
          )
          .catch((error) => {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            if (errorMessage.includes("dropped")) {
              results.dropped++;
            } else {
              results.failure++;
            }
            return false;
          }),
      );

      const chunkResults = await Promise.all(processingPromises);

      results.success += chunkResults.filter(
        (result) => result === true,
      ).length;
      results.failure += chunkResults.filter(
        (result) => result === false,
      ).length;

      if (chunkIndex < chunks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    return results;
  }

  /**
   * Get languages available for an assignment
   *
   * @param assignmentId - The assignment ID
   * @returns Array of language codes
   */
  async getAvailableLanguages(assignmentId: number): Promise<string[]> {
    const availableLanguages = new Set<string>();

    const assignmentTranslations =
      await this.prisma.assignmentTranslation.findMany({
        where: { assignmentId },
        select: { languageCode: true },
      });

    for (const translation of assignmentTranslations) {
      availableLanguages.add(translation.languageCode);
    }

    availableLanguages.add("en");

    return [...availableLanguages];
  }

  /**
   * Detect if the limiter appears to be stalled and reset it if necessary
   * Should be called before major translation operations
   */
  private checkLimiterHealth(): void {
    try {
      const counts = this.limiter.counts();

      if (
        counts.RUNNING > 10 &&
        counts.DONE < counts.RECEIVED * 0.2 &&
        counts.RECEIVED > 50
      ) {
        this.logger.warn(
          `Potential bottleneck issue detected: ${counts.RUNNING} running, ${counts.DONE} completed, ${counts.RECEIVED} received`,
        );
        this.resetLimiter();
        return;
      }

      if (counts.QUEUED > 500) {
        this.logger.warn(
          `High queue load: ${counts.QUEUED} jobs queued. Reducing accepting rate.`,
        );
        this.limiter.updateSettings({ maxConcurrent: 5 });

        setTimeout(() => {
          this.limiter.updateSettings({ maxConcurrent: 25 });
          this.logger.log("Restored normal concurrency limits");
        }, 30_000);
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error checking limiter health: ${errorMessage}`);
    }
  }

  /**
   * Reset the limiter if it appears to be stalled
   */
  private resetLimiter(): void {
    try {
      this.logger.warn(
        "Resetting bottleneck limiter due to potential stalled state",
      );

      void this.limiter.stop({ dropWaitingJobs: false }).then(() => {
        this.limiter.updateSettings({
          maxConcurrent: 25,
          minTime: 10,
          reservoir: 100,
          reservoirRefreshInterval: 10_000,
          reservoirRefreshAmount: 100,
          highWater: 2000,
          strategy: Bottleneck.strategy.LEAK,
          timeout: 30_000,
        });
        this.logger.log("Bottleneck limiter has been reset");
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error resetting limiter: ${errorMessage}`);
    }
  }

  /**
   * Apply translations to assignment data based on requested language
   *
   * @param assignment - The assignment data object
   * @param languageCode - The requested language code
   */
  async applyTranslationsToAssignment(
    assignment: GetAssignmentResponseDto | LearnerGetAssignmentResponseDto,
    languageCode: string,
  ): Promise<void> {
    if (!assignment) return;

    try {
      const originalLanguage = await this.llmFacadeService.getLanguageCode(
        assignment.introduction || "en",
      );

      if (languageCode === originalLanguage) return;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Error detecting language: ${errorMessage}. Continuing with translation anyway.`,
      );
    }

    const assignmentTranslation =
      await this.prisma.assignmentTranslation.findUnique({
        where: {
          assignmentId_languageCode: {
            assignmentId: assignment.id,
            languageCode: languageCode,
          },
        },
        select: {
          translatedName: true,
          translatedIntroduction: true,
          translatedInstructions: true,
          translatedGradingCriteriaOverview: true,
        },
      });

    if (assignmentTranslation) {
      if (assignmentTranslation.translatedName)
        assignment.name = assignmentTranslation.translatedName;
      if (assignmentTranslation.translatedIntroduction)
        assignment.introduction = assignmentTranslation.translatedIntroduction;
      if (assignmentTranslation.translatedInstructions)
        assignment.instructions = assignmentTranslation.translatedInstructions;
      if (assignmentTranslation.translatedGradingCriteriaOverview)
        assignment.gradingCriteriaOverview =
          assignmentTranslation.translatedGradingCriteriaOverview;
    }
  }

  /**
   * Initialize a progress tracker for comprehensive job status updates
   */
  private initializeProgressTracker(
    jobId: number,
    totalItems: number,
    startPercentage: number,
    endPercentage: number,
    stage: string,
    languageCount: number,
  ): ProgressTracker {
    return {
      jobId,
      totalItems,
      completedItems: 0,
      currentItemIndex: 0,
      startPercentage,
      endPercentage,
      currentStage: stage,
      languageTotal: languageCount,
      languageCompleted: 0,
    };
  }

  /**
   * Update the job status with current progress information - optimized to reduce DB calls
   */
  private async updateJobProgress(
    tracker: ProgressTracker,
    currentLanguage: string,
    currentItem?: string | number,
    additionalInfo?: string,
  ): Promise<void> {
    if (
      tracker.completedItems % this.STATUS_UPDATE_INTERVAL !== 0 &&
      tracker.completedItems !== tracker.totalItems
    ) {
      return;
    }

    const progressRange = tracker.endPercentage - tracker.startPercentage;
    const languageProgress = tracker.languageCompleted / tracker.languageTotal;
    const itemProgress = tracker.completedItems / tracker.totalItems;

    const combinedProgress = languageProgress * 0.3 + itemProgress * 0.7;
    const currentPercentage = Math.floor(
      tracker.startPercentage + progressRange * combinedProgress,
    );

    let progressMessage = `${tracker.currentStage}: ${currentLanguage}`;

    if (currentItem) {
      progressMessage += ` (Item ${tracker.currentItemIndex}/${tracker.totalItems})`;
    }

    if (additionalInfo) {
      progressMessage += ` - ${additionalInfo}`;
    }

    await this.jobStatusService.updateJobStatus(tracker.jobId, {
      status: "In Progress",
      progress: progressMessage,
      percentage: currentPercentage,
    });
  }

  /**
   * Simplified retry function for translation operations
   */
  private async executeWithOptimizedRetry<T>(
    operationName: string,
    translationFunction: () => Promise<T>,
    maxAttempts = this.MAX_RETRY_ATTEMPTS,
    jobId?: number,
  ): Promise<T> {
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        return await translationFunction();
      } catch (error) {
        attempts++;
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        if (attempts >= maxAttempts) {
          this.logger.error(
            `Failed ${operationName} after ${maxAttempts} attempts: ${errorMessage}`,
          );
          throw error;
        }

        const jitter = Math.random() * 200;
        await new Promise((resolve) =>
          setTimeout(resolve, this.RETRY_DELAY_BASE * attempts + jitter),
        );
      }
    }

    throw new Error(`Max retries exceeded for ${operationName}`);
  }

  /**
   * Mark a language as completed in the progress tracker
   */
  private incrementLanguageCompleted(tracker: ProgressTracker): void {
    tracker.languageCompleted++;
  }

  /**
   * Mark an item as completed in the progress tracker
   */
  private incrementCompletedItems(tracker: ProgressTracker): void {
    tracker.completedItems++;
  }

  /**
   * Set the current item index in the progress tracker
   */
  private setCurrentItemIndex(tracker: ProgressTracker, index: number): void {
    tracker.currentItemIndex = index;
  }

  /**
   * Translate an assignment to all supported languages
   * Optimized for performance with parallel processing
   *
   * @param assignmentId - The assignment ID
   * @param jobId - Optional job ID for progress tracking
   */
  async translateAssignment(
    assignmentId: number,
    jobId?: number,
    progressRange?: { start: number; end: number },
  ): Promise<void> {
    if (!this.languageTranslation) {
      this.logger.log("Translation is disabled in development mode");
      if (jobId && progressRange) {
        await this.jobStatusService.updateJobStatus(jobId, {
          status: "In Progress",
          progress: "Translation skipped (disabled in development mode)",
          percentage: progressRange.end - 5,
        });
      }
      return;
    }

    this.checkLimiterHealth();

    const assignment = (await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: {
        id: true,
        name: true,
        introduction: true,
        instructions: true,
        gradingCriteriaOverview: true,
      },
    })) as unknown as
      | GetAssignmentResponseDto
      | LearnerGetAssignmentResponseDto;

    if (!assignment) {
      if (jobId) {
        await this.jobStatusService.updateJobStatus(jobId, {
          status: "Failed",
          progress: `Assignment with id ${assignmentId} not found`,
          percentage: progressRange?.start || 0,
        });
      }
      throw new NotFoundException(
        `Assignment with id ${assignmentId} not found`,
      );
    }

    const start = progressRange?.start || 0;
    const end = progressRange?.end || 100;
    const range = end - start;

    if (jobId) {
      await this.jobStatusService.updateJobStatus(jobId, {
        status: "In Progress",
        progress: "Preparing assignment translation",
        percentage: start + Math.floor(range * 0.1),
      });
    }

    const supportedLanguages = getAllLanguageCodes() ?? ["en"];

    const progressTracker = jobId
      ? this.initializeProgressTracker(
          jobId,
          Math.ceil(supportedLanguages.length / this.MAX_BATCH_SIZE),
          start + Math.floor(range * 0.2),
          start + Math.floor(range * 0.9),
          "Translating assignment",
          supportedLanguages.length,
        )
      : undefined;

    const results = await this.processBatchesInParallel(
      supportedLanguages,
      async (lang: string) => {
        try {
          if (progressTracker && jobId) {
            await this.updateJobProgress(
              progressTracker,
              getLanguageNameFromCode(lang),
              undefined,
              "Translating",
            );
          }

          await this.executeWithOptimizedRetry(
            `translateAssignment-${assignmentId}-${lang}`,
            () => this.translateAssignmentToLanguage(assignment, lang),
            this.MAX_RETRY_ATTEMPTS,
            jobId,
          );

          if (progressTracker) {
            this.incrementLanguageCompleted(progressTracker);
            await this.updateJobProgress(
              progressTracker,
              getLanguageNameFromCode(lang),
              undefined,
              "Completed",
            );
          }

          return true;
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Failed to translate assignment to ${lang}: ${errorMessage}`,
          );
          return false;
        }
      },
      this.MAX_BATCH_SIZE,
      this.CONCURRENCY_LIMIT,
    );

    if (jobId) {
      await this.jobStatusService.updateJobStatus(jobId, {
        status: "In Progress",
        progress: `Assignment translated to ${results.success} languages`,
        percentage: end,
      });
    }

    this.logger.log(
      `Assignment #${assignmentId} translation results: ${results.success} successful, ${results.failure} failed, ${results.dropped} dropped/retried`,
    );
  }

  /**
   * Translate a question to all supported languages
   * Optimized for performance
   *
   * @param assignmentId - The assignment ID
   * @param questionId - The question ID
   * @param question - The question data
   * @param jobId - The job ID for progress tracking
   */
  async translateQuestion(
    assignmentId: number,
    questionId: number,
    question: QuestionDto,
    jobId: number,
  ): Promise<void> {
    if (!this.languageTranslation) {
      await this.jobStatusService.updateJobStatus(jobId, {
        status: "Completed",
        progress: `Translation skipped for question #${questionId} (disabled in development mode)`,
        percentage: 100,
      });
      return;
    }

    await this.jobStatusService.updateJobStatus(jobId, {
      status: "In Progress",
      progress: `Preparing question #${questionId} for translation`,
      percentage: 5,
    });

    const normalizedText = question.question.trim();
    const normalizedChoices = question.choices ?? null;

    let questionLang = "en";
    try {
      const detectedLang =
        await this.llmFacadeService.getLanguageCode(normalizedText);
      if (detectedLang && detectedLang !== "unknown") {
        questionLang = detectedLang;
      }
    } catch {
      this.logger.warn(
        `Language detection failed for question #${questionId}, using English as fallback`,
      );
    }

    await this.jobStatusService.updateJobStatus(jobId, {
      status: "In Progress",
      progress: `Question #${questionId} detected as ${getLanguageNameFromCode(
        questionLang,
      )}. Preparing translations...`,
      percentage: 15,
    });

    const supportedLanguages = getAllLanguageCodes() ?? ["en"];

    const progressTracker = this.initializeProgressTracker(
      jobId,
      Math.ceil(supportedLanguages.length / this.MAX_BATCH_SIZE),
      20,
      95,
      `Translating Question #${questionId}`,
      supportedLanguages.length,
    );

    // DELETE ALL existing translations for this question first
    await this.prisma.translation.deleteMany({
      where: {
        questionId: questionId,
        variantId: null,
      },
    });

    const results = await this.processBatchesInParallel(
      supportedLanguages,
      async (lang: string) => {
        try {
          await this.updateJobProgress(
            progressTracker,
            getLanguageNameFromCode(lang),
            undefined,
            lang === questionLang
              ? "Storing original content"
              : "Checking for existing translation",
          );

          await this.generateAndStoreTranslation(
            assignmentId,
            questionId,
            null,
            normalizedText,
            normalizedChoices,
            questionLang,
            lang,
          );

          this.incrementLanguageCompleted(progressTracker);
          await this.updateJobProgress(
            progressTracker,
            getLanguageNameFromCode(lang),
            undefined,
            lang === questionLang
              ? "Original stored ✓"
              : "Translation completed ✓",
          );

          return true;
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Failed to translate question ${questionId} to ${lang}: ${errorMessage}`,
          );
          return false;
        }
      },
      this.MAX_BATCH_SIZE,
      this.CONCURRENCY_LIMIT,
    );

    await this.jobStatusService.updateJobStatus(jobId, {
      status: "Completed",
      progress: `Question #${questionId} translated to ${results.success} languages (${results.failure} failed, ${results.dropped} retried)`,
      percentage: 100,
    });

    this.logger.log(
      `Question #${questionId} translation results: ${results.success} successful, ${results.failure} failed, ${results.dropped} dropped/retried`,
    );
  }

  /**
   * Translate a question variant to all supported languages
   * Optimized for performance
   *
   * @param assignmentId - The assignment ID
   * @param questionId - The question ID
   * @param variantId - The variant ID
   * @param variant - The variant data
   * @param jobId - The job ID for progress tracking
   */
  async translateVariant(
    assignmentId: number,
    questionId: number,
    variantId: number,
    variant: VariantDto,
    jobId: number,
  ): Promise<void> {
    if (!this.languageTranslation) {
      await this.jobStatusService.updateJobStatus(jobId, {
        status: "Completed",
        progress: `Translation skipped for variant #${variantId} (disabled in development mode)`,
        percentage: 100,
      });
      return;
    }

    await this.jobStatusService.updateJobStatus(jobId, {
      status: "In Progress",
      progress: `Preparing variant #${variantId} for translation`,
      percentage: 10,
    });

    const normalizedText = variant.variantContent.trim();
    const normalizedChoices = variant.choices ?? null;

    let variantLang = "en";
    try {
      const detectedLang =
        await this.llmFacadeService.getLanguageCode(normalizedText);
      if (detectedLang && detectedLang !== "unknown") {
        variantLang = detectedLang;
      }
    } catch {
      this.logger.warn(
        `Language detection failed for variant #${variantId}, using English as fallback`,
      );
    }

    const supportedLanguages = getAllLanguageCodes() ?? ["en"];

    const progressTracker = this.initializeProgressTracker(
      jobId,
      Math.ceil(supportedLanguages.length / this.MAX_BATCH_SIZE),
      20,
      95,
      `Translating Variant #${variantId}`,
      supportedLanguages.length,
    );

    // DELETE ALL existing translations for this variant first
    await this.prisma.translation.deleteMany({
      where: {
        questionId: questionId,
        variantId: variantId,
      },
    });

    const results = await this.processBatchesInParallel(
      supportedLanguages,
      async (lang: string) => {
        try {
          await this.updateJobProgress(
            progressTracker,
            getLanguageNameFromCode(lang),
            undefined,
            lang === variantLang
              ? "Storing original content"
              : "Checking for existing translation",
          );

          await this.generateAndStoreTranslation(
            assignmentId,
            questionId,
            variantId,
            normalizedText,
            normalizedChoices,
            variantLang,
            lang,
          );

          this.incrementLanguageCompleted(progressTracker);
          await this.updateJobProgress(
            progressTracker,
            getLanguageNameFromCode(lang),
            undefined,
            lang === variantLang
              ? "Original stored ✓"
              : "Translation completed ✓",
          );

          return true;
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Failed to translate variant ${variantId} to ${lang}: ${errorMessage}`,
          );
          return false;
        }
      },
      this.MAX_BATCH_SIZE,
      this.CONCURRENCY_LIMIT,
    );

    await this.jobStatusService.updateJobStatus(jobId, {
      status: "Completed",
      progress: `Variant #${variantId} translated to ${results.success} languages (${results.failure} failed, ${results.dropped} retried)`,
      percentage: 100,
    });

    this.logger.log(
      `Variant #${variantId} translation results: ${results.success} successful, ${results.failure} failed, ${results.dropped} dropped/retried`,
    );
  }

  /**
   * Translate an assignment to a specific language
   * Optimized implementation
   *
   * @param assignment - The assignment data
   * @param lang - The target language code
   */
  private async translateAssignmentToLanguage(
    assignment: GetAssignmentResponseDto | LearnerGetAssignmentResponseDto,
    lang: string,
  ): Promise<void> {
    try {
      const existingTranslation =
        await this.prisma.assignmentTranslation.findFirst({
          where: { assignmentId: assignment.id, languageCode: lang },
        });

      await (existingTranslation
        ? this.updateExistingAssignmentTranslation(
            assignment,
            existingTranslation as unknown as IExistingTranslation,
            lang,
          )
        : this.createNewAssignmentTranslation(assignment, lang));
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to translate assignment ${assignment.id} to ${lang}: ${errorMessage}`,
      );
      throw error;
    }
  }

  /**
   * Update an existing assignment translation
   * Optimized to reduce unnecessary API calls
   *
   * @param assignment - The assignment data
   * @param existingTranslation - The existing translation record
   * @param lang - The target language code
   */
  private async updateExistingAssignmentTranslation(
    assignment: GetAssignmentResponseDto | LearnerGetAssignmentResponseDto,
    existingTranslation: IExistingTranslation,
    lang: string,
  ): Promise<void> {
    const updatedData: Prisma.AssignmentTranslationUpdateInput = {};
    const translationPromises: Array<Promise<void>> = [];

    if (assignment.name !== existingTranslation.name && assignment.name) {
      translationPromises.push(
        this.llmFacadeService
          .translateText(assignment.name, lang, assignment.id)
          .then((translated) => {
            updatedData.translatedName = translated;
            updatedData.name = assignment.name;
          })
          .catch((error: unknown) => {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to translate name: ${errorMessage}`);
          }),
      );
    }

    if (
      assignment.instructions !== existingTranslation.instructions &&
      assignment.instructions
    ) {
      translationPromises.push(
        this.llmFacadeService
          .translateText(assignment.instructions, lang, assignment.id)
          .then((translated) => {
            updatedData.translatedInstructions = translated;
            updatedData.instructions = assignment.instructions;
          })
          .catch((error: unknown) => {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            this.logger.error(
              `Failed to translate instructions: ${errorMessage}`,
            );
          }),
      );
    }

    if (
      assignment.gradingCriteriaOverview !==
        existingTranslation.gradingCriteriaOverview &&
      assignment.gradingCriteriaOverview
    ) {
      translationPromises.push(
        this.llmFacadeService
          .translateText(
            assignment.gradingCriteriaOverview,
            lang,
            assignment.id,
          )
          .then((translated) => {
            updatedData.translatedGradingCriteriaOverview = translated;
            updatedData.gradingCriteriaOverview =
              assignment.gradingCriteriaOverview;
          })
          .catch((error: unknown) => {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            this.logger.error(
              `Failed to translate grading criteria: ${errorMessage}`,
            );
          }),
      );
    }

    if (
      assignment.introduction !== existingTranslation.introduction &&
      assignment.introduction
    ) {
      translationPromises.push(
        this.llmFacadeService
          .translateText(assignment.introduction, lang, assignment.id)
          .then((translated) => {
            updatedData.translatedIntroduction = translated;
            updatedData.introduction = assignment.introduction;
          })
          .catch((error: unknown) => {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            this.logger.error(
              `Failed to translate introduction: ${errorMessage}`,
            );
          }),
      );
    }

    await Promise.all(translationPromises);

    if (Object.keys(updatedData).length > 0) {
      await this.prisma.assignmentTranslation.update({
        where: { id: existingTranslation.id },
        data: updatedData,
      });
    }
  }

  /**
   * Create a new assignment translation
   * Optimized for parallel processing of translation requests
   *
   * @param assignment - The assignment data
   * @param lang - The target language code
   */
  private async createNewAssignmentTranslation(
    assignment: GetAssignmentResponseDto | LearnerGetAssignmentResponseDto,
    lang: string,
  ): Promise<void> {
    const translationPromises: Array<Promise<any>> = [];
    const translatedData: Record<string, string> = {};

    const fieldsToTranslate = [
      { field: "name", source: assignment.name || "" },
      { field: "instructions", source: assignment.instructions || "" },
      {
        field: "gradingCriteriaOverview",
        source: assignment.gradingCriteriaOverview || "",
      },
      { field: "introduction", source: assignment.introduction || "" },
    ];

    for (const { field, source } of fieldsToTranslate) {
      if (source) {
        translationPromises.push(
          this.llmFacadeService
            .translateText(source, lang, assignment.id)
            .then((translated) => {
              translatedData[field] = translated;
              return { field, translated };
            })
            .catch((error: unknown) => {
              const errorMessage =
                error instanceof Error ? error.message : String(error);
              this.logger.error(
                `Failed to translate ${field}: ${errorMessage}`,
              );
              translatedData[field] = source;
              return { field, translated: source };
            }),
        );
      } else {
        translatedData[field] = "";
      }
    }

    await Promise.all(translationPromises);

    try {
      await this.prisma.assignmentTranslation.create({
        data: {
          assignment: { connect: { id: assignment.id } },
          languageCode: lang,
          name: assignment.name || "",
          translatedName: translatedData.name,
          instructions: assignment.instructions || "",
          translatedInstructions: translatedData.instructions,
          gradingCriteriaOverview: assignment.gradingCriteriaOverview || "",
          translatedGradingCriteriaOverview:
            translatedData.gradingCriteriaOverview,
          introduction: assignment.introduction || "",
          translatedIntroduction: translatedData.introduction,
        },
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error creating translation record: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Find an existing translation for reuse
   * Optimized query performance
   *
   * @param text - The text to translate
   * @param choices - The choices to translate
   * @param languageCode - The target language code
   * @returns Existing translation if found
   */
  private async findExistingTranslation(
    text: string,
    choices: Choice[] | null,
    languageCode: string,
  ): Promise<Translation | null> {
    try {
      return await this.prisma.translation.findFirst({
        where: {
          languageCode,
          untranslatedText: text,
          untranslatedChoices: { equals: this.prepareJsonValue(choices) },
        },
        select: {
          id: true,
          questionId: true,
          variantId: true,
          languageCode: true,
          translatedText: true,
          translatedChoices: true,
          untranslatedText: true,
          untranslatedChoices: true,
          createdAt: true,
        },
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error finding existing translation: ${errorMessage}`);
      return null;
    }
  }

  /**
   * Link an existing translation to a question or variant
   * Optimized for performance
   *
   * @param questionId - The question ID
   * @param variantId - The variant ID (or null)
   * @param existingTranslation - The existing translation to reuse
   * @param normalizedText - The original text
   * @param normalizedChoices - The original choices
   * @param languageCode - The target language code
   */
  private async linkExistingTranslation(
    questionId: number,
    variantId: number | null,
    existingTranslation: Translation,
    normalizedText: string,
    normalizedChoices: Choice[] | null,
    languageCode: string,
  ): Promise<void> {
    try {
      const existingCount = await this.prisma.translation.count({
        where: {
          questionId,
          variantId,
          languageCode,
        },
      });

      if (existingCount === 0) {
        await this.prisma.translation.create({
          data: {
            questionId,
            variantId,
            languageCode,
            untranslatedText: normalizedText,
            untranslatedChoices: this.prepareJsonValue(normalizedChoices),
            translatedText: existingTranslation.translatedText,
            translatedChoices:
              existingTranslation.translatedChoices ?? Prisma.JsonNull,
          },
        });
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error linking existing translation: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Generate and store a new translation
   * Optimized for performance
   *
   * @param assignmentId - The assignment ID
   * @param questionId - The question ID
   * @param variantId - The variant ID (or null)
   * @param normalizedText - The original text
   * @param normalizedChoices - The original choices
   * @param sourceLanguage - The source language code
   * @param targetLanguage - The target language code
   */
  /**
   * Generate and store translation (creates new record each time)
   */
  private async generateAndStoreTranslation(
    assignmentId: number,
    questionId: number,
    variantId: number | null,
    originalText: string,
    originalChoices: Choice[] | null,
    sourceLanguage: string,
    targetLanguage: string,
  ): Promise<void> {
    // OPTIMIZATION: Check if we already have a translation for this EXACT text
    const existingTranslation = await this.prisma.translation.findFirst({
      where: {
        languageCode: targetLanguage,
        untranslatedText: originalText, // Exact match on the text content
        untranslatedChoices: { equals: this.prepareJsonValue(originalChoices) },
      },
      orderBy: { createdAt: "desc" }, // Get the most recent one
    });

    if (existingTranslation) {
      // Reuse existing translation for this exact content
      await this.prisma.translation.create({
        data: {
          questionId,
          variantId,
          languageCode: targetLanguage,
          untranslatedText: originalText,
          untranslatedChoices: this.prepareJsonValue(originalChoices),
          translatedText: existingTranslation.translatedText, // Reuse existing translation
          translatedChoices: existingTranslation.translatedChoices,
        },
      });
      return;
    }

    // No existing translation found - generate new one
    if (sourceLanguage.toLowerCase() === targetLanguage.toLowerCase()) {
      // Same language - store original content
      await this.prisma.translation.create({
        data: {
          questionId,
          variantId,
          languageCode: targetLanguage,
          untranslatedText: originalText,
          untranslatedChoices: this.prepareJsonValue(originalChoices),
          translatedText: originalText,
          translatedChoices: this.prepareJsonValue(originalChoices),
        },
      });
      return;
    }

    // Different language - translate it
    const translationPromises: Array<Promise<any>> = [];
    let translatedText: string = originalText;
    let translatedChoices: Choice[] | null = originalChoices;

    // Translate the text
    translationPromises.push(
      this.executeWithOptimizedRetry(
        `translateQuestionText-${questionId}-${targetLanguage}`,
        () =>
          this.llmFacadeService.generateQuestionTranslation(
            assignmentId,
            originalText,
            targetLanguage,
          ),
      )
        .then((result) => {
          translatedText = result;
          return result;
        })
        .catch((error: unknown) => {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Failed to translate question text: ${errorMessage}`,
          );
          return originalText;
        }),
    );

    // Translate the choices if they exist
    if (originalChoices) {
      translationPromises.push(
        this.executeWithOptimizedRetry(
          `translateChoices-${questionId}-${targetLanguage}`,
          () =>
            this.llmFacadeService.generateChoicesTranslation(
              originalChoices,
              assignmentId,
              targetLanguage,
            ),
        )
          .then((result) => {
            translatedChoices = result;
            return result;
          })
          .catch((error: unknown) => {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to translate choices: ${errorMessage}`);
            return originalChoices;
          }),
      );
    }

    await Promise.all(translationPromises);

    // Create new translation record
    await this.prisma.translation.create({
      data: {
        questionId,
        variantId,
        languageCode: targetLanguage,
        untranslatedText: originalText,
        untranslatedChoices: this.prepareJsonValue(originalChoices),
        translatedText,
        translatedChoices: this.prepareJsonValue(translatedChoices),
      },
    });
  }
  /**
   * Prepare a value for storage as Prisma.JsonValue
   *
   * @param value - The value to prepare
   * @returns Prepared JSON value
   */
  private prepareJsonValue(value: unknown): Prisma.JsonValue {
    if (value === null || value === undefined) {
      return null;
    }

    try {
      return JSON.parse(JSON.stringify(value)) as Prisma.JsonValue;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error preparing JSON value: ${String(errorMessage)}`);
      return null;
    }
  }
}
