/* eslint-disable unicorn/no-null */
import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import Bottleneck from "bottleneck";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import { LLM_RESOLVER_SERVICE } from "src/api/llm/llm.constants";
import { LLMResolverService } from "src/api/llm/core/services/llm-resolver.service";
import { PrismaService } from "src/database/prisma.service";
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
  private readonly limiter: Bottleneck; // default high-throughput
  private readonly watsonxLimiter: Bottleneck; // conservative for IBM Watsonx
  private useWatsonxLimiterForTranslation = false;

  // Performance optimized settings
  private readonly MAX_BATCH_SIZE = 100; // Increased for better throughput
  private readonly CONCURRENCY_LIMIT = 50; // Increased concurrency
  private readonly MAX_RETRY_ATTEMPTS = 2;
  private readonly RETRY_DELAY_BASE = 100; // Reduced delay for faster retries
  private readonly STATUS_UPDATE_INTERVAL = 20; // Reduced DB calls
  private readonly OPERATION_TIMEOUT = 30_000; // 30 seconds per operation
  private readonly JOB_TIMEOUT = 600_000; // 10 minutes for large jobs
  private readonly MAX_STUCK_OPERATIONS = 15; // Allow more stuck operations
  private readonly ADAPTIVE_BATCH_SIZE = true; // Enable adaptive batching

  // Track stuck operations and performance
  private stuckOperations = new Set<string>();
  private jobStartTimes = new Map<number, number>();
  private jobCancellationFlags = new Map<number, boolean>();
  private operationStats = {
    totalOperations: 0,
    successfulOperations: 0,
    failedOperations: 0,
    averageResponseTime: 0,
    consecutiveFailures: 0,
    lastFailureTime: 0,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmFacadeService: LlmFacadeService,
    private readonly jobStatusService: JobStatusServiceV2,
    @Inject(LLM_RESOLVER_SERVICE)
    private readonly llmResolver: LLMResolverService,
  ) {
    this.languageTranslation =
      process.env.ENABLE_TRANSLATION.toString().toLowerCase() === "true" ||
      false;

    this.limiter = new Bottleneck({
      maxConcurrent: this.CONCURRENCY_LIMIT,
      minTime: 2,
      reservoirRefreshInterval: 3000,
      reservoirRefreshAmount: 500,
      highWater: 5000,
      strategy: Bottleneck.strategy.OVERFLOW,
      timeout: this.OPERATION_TIMEOUT,
    });
    // More conservative limiter for Watsonx-backed translations
    this.watsonxLimiter = new Bottleneck({
      maxConcurrent: 8,
      minTime: 50, // ~20 rps spacing
      reservoir: 20,
      reservoirRefreshInterval: 1000,
      reservoirRefreshAmount: 20,
      highWater: 1000,
      strategy: Bottleneck.strategy.OVERFLOW,
      timeout: this.OPERATION_TIMEOUT,
    });
    setInterval(() => this.checkLimiterHealth(), 30_000);
    setInterval(() => this.checkJobTimeouts(), 60_000); // Check every minute
  }

  /**
   * Decide which limiter to use based on current translation model assignment
   */
  private async syncLimiterForTranslationModel(): Promise<void> {
    try {
      const modelKey = await this.llmResolver.getModelKeyWithFallback(
        "translation",
        "gpt-4o-mini",
      );
      const isWatsonx = this.isWatsonxModel(modelKey);
      if (isWatsonx !== this.useWatsonxLimiterForTranslation) {
        this.useWatsonxLimiterForTranslation = isWatsonx;
        this.logger.debug(
          `Translation limiter set to ${isWatsonx ? "Watsonx profile" : "default profile"} (model: ${modelKey})`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not resolve translation model; using default limiter. Reason: ${message}`,
      );
      this.useWatsonxLimiterForTranslation = false;
    }
  }

  private isWatsonxModel(modelKey: string): boolean {
    if (!modelKey) return false;
    return (
      modelKey.startsWith("granite-") ||
      modelKey.startsWith("gpt-oss-") ||
      modelKey === "llama-3-3-70b-instruct" ||
      modelKey === "llama-4-maverick"
    );
  }

  private getActiveLimiter(): Bottleneck {
    return this.useWatsonxLimiterForTranslation
      ? this.watsonxLimiter
      : this.limiter;
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
    _concurrencyLimit = this.CONCURRENCY_LIMIT,
  ): Promise<BatchProcessResult> {
    const results: BatchProcessResult = { success: 0, failure: 0, dropped: 0 };
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += batchSize) {
      chunks.push(items.slice(index, index + batchSize));
    }

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];

      const processingPromises = chunk.map((item) =>
        this.getActiveLimiter()
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
   * A language is only available if BOTH assignment metadata AND all questions are translated
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
   * Helper method to detect language of text
   */
  async detectLanguage(text: string, assignmentId = 1): Promise<string> {
    try {
      const detectedLang = await this.llmFacadeService.getLanguageCode(
        text,
        assignmentId,
      );
      return detectedLang && detectedLang !== "unknown" ? detectedLang : "en";
    } catch {
      return "en";
    }
  }

  /**
   * Ensure all questions and variants have complete translations
   * This is a safety check to run after publishing
   *
   * @param assignmentId - The assignment ID
   * @returns Object with completeness status
   */
  async ensureTranslationCompleteness(assignmentId: number): Promise<{
    isComplete: boolean;
    missingTranslations: Array<{
      questionId: number;
      variantId: number | null;
      missingLanguages: string[];
    }>;
  }> {
    const missingTranslations: Array<{
      questionId: number;
      variantId: number | null;
      missingLanguages: string[];
    }> = [];

    const supportedLanguages = getAllLanguageCodes() ?? ["en"];

    // Get all questions and variants
    const questions = await this.prisma.question.findMany({
      where: {
        assignmentId,
        isDeleted: false,
      },
      include: {
        variants: {
          where: { isDeleted: false },
        },
        translations: {
          select: { languageCode: true, variantId: true },
        },
      },
    });

    for (const question of questions) {
      // Check question translations
      const questionTranslations = question.translations.filter(
        (t) => t.variantId === null,
      );
      const questionLanguages = new Set(
        questionTranslations.map((t) => t.languageCode),
      );

      const missingQuestionLangs = supportedLanguages.filter(
        (lang) => !questionLanguages.has(lang),
      );

      if (missingQuestionLangs.length > 0) {
        missingTranslations.push({
          questionId: question.id,
          variantId: null,
          missingLanguages: missingQuestionLangs,
        });
      }

      // Check variant translations
      for (const variant of question.variants) {
        const variantTranslations = question.translations.filter(
          (t) => t.variantId === variant.id,
        );
        const variantLanguages = new Set(
          variantTranslations.map((t) => t.languageCode),
        );

        const missingVariantLangs = supportedLanguages.filter(
          (lang) => !variantLanguages.has(lang),
        );

        if (missingVariantLangs.length > 0) {
          missingTranslations.push({
            questionId: question.id,
            variantId: variant.id,
            missingLanguages: missingVariantLangs,
          });
        }
      }
    }

    return {
      isComplete: missingTranslations.length === 0,
      missingTranslations,
    };
  }

  /**
   * Quick validation that only checks if translations exist without language detection
   * Much faster than full language consistency validation
   *
   * @param assignmentId - The assignment ID
   * @returns True if basic validation passes
   */
  async quickValidateAssignmentTranslations(
    assignmentId: number,
  ): Promise<boolean> {
    try {
      // Just check if we have recent translations (created in last 24 hours)
      const recentTranslationsCount =
        await this.prisma.assignmentTranslation.count({
          where: {
            assignmentId,
            updatedAt: {
              gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours ago
            },
          },
        });

      // If we have recent translations, assume they're good
      if (recentTranslationsCount > 0) {
        return true;
      }

      // Otherwise, do a quick count check
      const totalTranslations = await this.prisma.assignmentTranslation.count({
        where: { assignmentId },
      });

      return totalTranslations > 0;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error in quick translation validation: ${errorMessage}`,
      );
      return true; // Default to assuming it's okay
    }
  }

  /**
   * Check if the assignment content language matches the expected language codes
   * This validates that translations are correctly aligned with their language codes
   * WARNING: This is an expensive operation that makes API calls for language detection
   *
   * @param assignmentId - The assignment ID
   * @returns Object with validation results and mismatched languages
   */
  async validateAssignmentLanguageConsistency(assignmentId: number): Promise<{
    isConsistent: boolean;
    mismatchedLanguages: string[];
    details: Array<{
      languageCode: string;
      detectedLanguage: string;
      needsRetranslation: boolean;
    }>;
  }> {
    const mismatchedLanguages: string[] = [];
    const details: Array<{
      languageCode: string;
      detectedLanguage: string;
      needsRetranslation: boolean;
    }> = [];
    try {
      // Get all assignment translations
      const assignmentTranslations =
        await this.prisma.assignmentTranslation.findMany({
          where: { assignmentId },
          select: {
            languageCode: true,
            translatedName: true,
            translatedIntroduction: true,
            translatedInstructions: true,
          },
        });

      // Check each translation for language consistency
      for (const translation of assignmentTranslations) {
        // Skip if no translated content exists
        if (
          !translation.translatedName &&
          !translation.translatedIntroduction &&
          !translation.translatedInstructions
        ) {
          continue;
        }

        // Use the most substantial text for language detection
        const textToCheck =
          translation.translatedIntroduction ||
          translation.translatedInstructions ||
          translation.translatedName ||
          "";

        if (textToCheck) {
          const detectedLanguage = await this.llmFacadeService.getLanguageCode(
            textToCheck,
            assignmentId,
          );

          if (detectedLanguage && detectedLanguage !== "unknown") {
            // Normalize language codes for comparison
            const normalizedDetected = detectedLanguage
              .toLowerCase()
              .split("-")[0];
            const normalizedExpected = translation.languageCode
              .toLowerCase()
              .split("-")[0];

            const isMatching = normalizedDetected === normalizedExpected;

            details.push({
              languageCode: translation.languageCode,
              detectedLanguage,
              needsRetranslation: !isMatching,
            });

            if (!isMatching) {
              mismatchedLanguages.push(translation.languageCode);
              this.logger.warn(
                `Language mismatch detected for assignment ${assignmentId}: ` +
                  `Expected ${translation.languageCode}, but detected ${detectedLanguage}`,
              );
            }
          }
        }
      }

      // Check question and variant translations using batch processing
      const translations = await this.prisma.translation.findMany({
        where: {
          question: {
            assignmentId,
            isDeleted: false,
          },
        },
        select: {
          languageCode: true,
          translatedText: true,
          questionId: true,
          variantId: true,
        },
        take: 20, // Reduced sample size for faster validation
      });

      if (translations.length > 0) {
        // Batch language detection for all translation texts
        const textsToCheck = translations
          .filter((t): t is typeof t & { translatedText: string } =>
            Boolean(t.translatedText),
          )
          .map((t) => t.translatedText);

        if (textsToCheck.length > 0) {
          const detectedLanguages =
            await this.llmFacadeService.batchGetLanguageCodes(
              textsToCheck,
              assignmentId,
            );

          let textIndex = 0;
          for (const translation of translations) {
            if (translation.translatedText) {
              const detectedLanguage = detectedLanguages[textIndex++];

              if (detectedLanguage && detectedLanguage !== "unknown") {
                const normalizedDetected = detectedLanguage
                  .toLowerCase()
                  .split("-")[0];
                const normalizedExpected = translation.languageCode
                  .toLowerCase()
                  .split("-")[0];

                if (normalizedDetected !== normalizedExpected) {
                  if (!mismatchedLanguages.includes(translation.languageCode)) {
                    mismatchedLanguages.push(translation.languageCode);
                  }
                  this.logger.warn(
                    `Language mismatch in question/variant translation: ` +
                      `Expected ${translation.languageCode}, detected ${detectedLanguage} ` +
                      `(Question: ${translation.questionId}, Variant: ${translation.variantId})`,
                  );
                }
              }
            }
          }
        }
      }

      return {
        isConsistent: mismatchedLanguages.length === 0,
        mismatchedLanguages,
        details,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error validating language consistency: ${errorMessage}`,
      );
      return {
        isConsistent: true, // Default to consistent on error
        mismatchedLanguages: [],
        details: [],
      };
    }
  }

  /**
   * Check if a specific language is fully available for an assignment
   * More efficient than getting all available languages when checking just one
   *
   * @param assignmentId - The assignment ID
   * @param languageCode - The language code to check
   * @returns True if language is fully available
   */
  async isLanguageAvailable(
    assignmentId: number,
    languageCode: string,
  ): Promise<boolean> {
    // English is always available
    if (languageCode.toLowerCase() === "en") {
      return true;
    }

    // Check if assignment translation exists
    const assignmentTranslation =
      await this.prisma.assignmentTranslation.findFirst({
        where: { assignmentId, languageCode },
      });

    if (!assignmentTranslation) {
      return false;
    }

    // Get all questions and variants for this assignment
    const questions = await this.prisma.question.findMany({
      where: {
        assignmentId,
        isDeleted: false,
      },
      select: {
        id: true,
        variants: {
          where: { isDeleted: false },
          select: { id: true },
        },
      },
    });

    if (questions.length === 0) {
      // No questions, so assignment translation is sufficient
      return true;
    }

    // Get all question and variant IDs
    const questionIds = questions.map((q) => q.id);
    const variantIds = questions.flatMap((q) => q.variants.map((v) => v.id));
    const requiredCount = questionIds.length + variantIds.length;

    if (requiredCount === 0) {
      // No content to translate
      return true;
    }

    // Count actual translations for this language
    const translationCount = await this.prisma.translation.count({
      where: {
        languageCode,
        OR: [
          { questionId: { in: questionIds }, variantId: null },
          { variantId: { in: variantIds } },
        ],
      },
    });

    return translationCount >= requiredCount;
  }

  /**
   * Detect if the limiter appears to be stalled and reset it if necessary
   * Should be called before major translation operations
   */
  private checkLimiterHealth(): void {
    try {
      const limiter = this.getActiveLimiter();
      const counts = limiter.counts();

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
        limiter.updateSettings({ maxConcurrent: 5 });

        setTimeout(() => {
          limiter.updateSettings({ maxConcurrent: 25 });
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

      const limiter = this.getActiveLimiter();
      void limiter.stop({ dropWaitingJobs: false }).then(() => {
        limiter.updateSettings({
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
        assignment.id,
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
    tracker: ProgressTracker | undefined,
    currentLanguage: string,
    currentItem?: string | number,
    additionalInfo?: string,
  ): Promise<void> {
    if (!tracker) {
      return;
    }
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
   * Enhanced retry function with timeout and circuit breaker
   */
  private async executeWithOptimizedRetry<T>(
    operationName: string,
    translationFunction: () => Promise<T>,
    maxAttempts = this.MAX_RETRY_ATTEMPTS,
    _jobId?: number,
  ): Promise<T> {
    let attempts = 0;
    const operationId = `${operationName}-${Date.now()}`;

    while (attempts < maxAttempts) {
      try {
        this.stuckOperations.add(operationId);

        // Create timeout promise
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(
              new Error(
                `Operation ${operationName} timed out after ${this.OPERATION_TIMEOUT}ms`,
              ),
            );
          }, this.OPERATION_TIMEOUT);
        });

        // Race between operation and timeout
        const result = await Promise.race([
          translationFunction(),
          timeoutPromise,
        ]);

        this.stuckOperations.delete(operationId);
        return result;
      } catch (error) {
        attempts++;
        this.stuckOperations.delete(operationId);

        const errorMessage =
          error instanceof Error ? error.message : String(error);

        // Check if this is a timeout error
        const isTimeout = errorMessage.includes("timed out");

        if (attempts >= maxAttempts) {
          this.logger.error(
            `Failed ${operationName} after ${maxAttempts} attempts: ${errorMessage}`,
          );

          // Track persistently stuck operations
          if (isTimeout) {
            this.handleStuckOperation(operationName);
          }

          throw error;
        }

        // Longer backoff for timeout errors
        const baseDelay = isTimeout
          ? this.RETRY_DELAY_BASE * 2
          : this.RETRY_DELAY_BASE;
        const jitter = Math.random() * 200;
        await new Promise((resolve) =>
          setTimeout(resolve, baseDelay * attempts + jitter),
        );
      }
    }

    throw new Error(`Max retries exceeded for ${operationName}`);
  }

  /**
   * Handle stuck operations by resetting limiter if needed
   */
  private handleStuckOperation(_operationName: string): void {
    this.operationStats.consecutiveFailures++;
    this.operationStats.lastFailureTime = Date.now();

    if (this.stuckOperations.size >= this.MAX_STUCK_OPERATIONS) {
      this.logger.warn(
        `Too many stuck operations (${this.stuckOperations.size}), resetting limiter`,
      );
      this.resetLimiter();
      this.stuckOperations.clear();
      this.operationStats.consecutiveFailures = 0;
    }
  }

  /**
   * Cancel a job and mark it for termination
   */
  async cancelJob(jobId: number): Promise<void> {
    this.logger.warn(`Cancelling job ${jobId}`);
    this.jobCancellationFlags.set(jobId, true);

    try {
      await this.jobStatusService.updateJobStatus(jobId, {
        status: "Failed",
        progress: "Job cancelled due to timeout or user request",
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error updating cancelled job status: ${errorMessage}`);
    }
  }

  /**
   * Check if a job should be cancelled
   */
  private isJobCancelled(jobId?: number): boolean {
    if (!jobId) return false;
    return this.jobCancellationFlags.get(jobId) === true;
  }

  /**
   * Clean up cancelled job resources
   */
  private cleanupCancelledJob(jobId: number): void {
    this.jobCancellationFlags.delete(jobId);
    this.jobStartTimes.delete(jobId);
  }

  /**
   * Check for jobs that have exceeded the timeout and cancel them
   */
  private checkJobTimeouts(): void {
    const now = Date.now();
    const expiredJobs: number[] = [];

    for (const [jobId, startTime] of this.jobStartTimes.entries()) {
      if (now - startTime > this.JOB_TIMEOUT) {
        expiredJobs.push(jobId);
      }
    }

    for (const jobId of expiredJobs) {
      this.logger.warn(
        `Job ${jobId} exceeded timeout (${this.JOB_TIMEOUT}ms), cancelling`,
      );
      void this.cancelJob(jobId).then(() => this.cleanupCancelledJob(jobId));
    }
  }

  /**
   * Mark a language as completed in the progress tracker
   */
  private incrementLanguageCompleted(
    tracker: ProgressTracker | undefined,
  ): void {
    if (!tracker) {
      return;
    }
    tracker.languageCompleted++;
  }

  /**
   * Mark an item as completed in the progress tracker
   */
  private incrementCompletedItems(tracker: ProgressTracker | undefined): void {
    if (!tracker) {
      return;
    }
    tracker.completedItems++;
  }

  /**
   * Set the current item index in the progress tracker
   */
  private setCurrentItemIndex(
    tracker: ProgressTracker | undefined,
    index: number,
  ): void {
    if (!tracker) {
      return;
    }
    tracker.currentItemIndex = index;
  }

  /**
   * Force retranslation of an assignment for specific languages
   * Used when language mismatches are detected
   *
   * @param assignmentId - The assignment ID
   * @param languageCodes - Array of language codes to retranslate
   * @param jobId - Optional job ID for progress tracking
   */
  async retranslateAssignmentForLanguages(
    assignmentId: number,
    languageCodes: string[],
    jobId?: number,
  ): Promise<void> {
    if (languageCodes.length === 0) {
      return;
    }

    this.logger.log(
      `Force retranslating assignment ${assignmentId} for languages: ${languageCodes.join(
        ", ",
      )}`,
    );

    // Delete existing translations for the specified languages
    await this.prisma.assignmentTranslation.deleteMany({
      where: {
        assignmentId,
        languageCode: { in: languageCodes },
      },
    });

    await this.prisma.translation.deleteMany({
      where: {
        question: {
          assignmentId,
        },
        languageCode: { in: languageCodes },
      },
    });

    // Get assignment data
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: {
        id: true,
        name: true,
        introduction: true,
        instructions: true,
        gradingCriteriaOverview: true,
      },
    });

    if (!assignment) {
      throw new NotFoundException(
        `Assignment with id ${assignmentId} not found`,
      );
    }

    // Retranslate assignment for specific languages
    const progressTracker = jobId
      ? this.initializeProgressTracker(
          jobId,
          languageCodes.length,
          10,
          30,
          "Retranslating assignment metadata",
          languageCodes.length,
        )
      : undefined;

    await this.syncLimiterForTranslationModel();
    await this.processBatchesInParallel(
      languageCodes,
      async (lang: string) => {
        try {
          await this.translateAssignmentToLanguage(
            assignment as unknown as GetAssignmentResponseDto,
            lang,
          );
          if (progressTracker) {
            this.incrementLanguageCompleted(progressTracker);
          }
          return true;
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Failed to retranslate assignment to ${lang}: ${errorMessage}`,
          );
          return false;
        }
      },
      10, // Smaller batch size for targeted retranslation
      25, // Lower concurrency
    );

    // Get all questions and variants
    const questions = await this.prisma.question.findMany({
      where: {
        assignmentId,
        isDeleted: false,
      },
      include: {
        variants: {
          where: { isDeleted: false },
        },
      },
    });

    // Retranslate questions and variants
    if (jobId) {
      await this.jobStatusService.updateJobStatus(jobId, {
        status: "In Progress",
        progress: `Retranslating ${questions.length} questions for ${languageCodes.length} languages`,
        percentage: 40,
      });
    }

    let processedItems = 0;
    const totalItems =
      questions.reduce(
        (accumulator, q) => accumulator + 1 + q.variants.length,
        0,
      ) * languageCodes.length;

    for (const question of questions) {
      // Retranslate question
      for (const lang of languageCodes) {
        await this.generateAndStoreTranslation(
          assignmentId,
          question.id,
          null,
          question.question,
          question.choices,
          await this.llmFacadeService.getLanguageCode(
            question.question,
            assignmentId,
          ),
          lang,
        );
        processedItems++;

        if (jobId && processedItems % 10 === 0) {
          const percentage =
            40 + Math.floor((processedItems / totalItems) * 50);
          await this.jobStatusService.updateJobStatus(jobId, {
            status: "In Progress",
            progress: `Retranslating content: ${processedItems}/${totalItems} items`,
            percentage,
          });
        }
      }

      // Retranslate variants
      for (const variant of question.variants) {
        for (const lang of languageCodes) {
          await this.generateAndStoreTranslation(
            assignmentId,
            question.id,
            variant.id,
            variant.variantContent,
            variant.choices,
            await this.llmFacadeService.getLanguageCode(
              variant.variantContent,
              assignmentId,
            ),
            lang,
          );
          processedItems++;

          if (jobId && processedItems % 10 === 0) {
            const percentage =
              40 + Math.floor((processedItems / totalItems) * 50);
            await this.jobStatusService.updateJobStatus(jobId, {
              status: "In Progress",
              progress: `Retranslating content: ${processedItems}/${totalItems} items`,
              percentage,
            });
          }
        }
      }
    }

    if (jobId) {
      await this.jobStatusService.updateJobStatus(jobId, {
        status: "In Progress",
        progress: `Retranslation completed for ${languageCodes.length} languages`,
        percentage: 95,
      });
    }

    this.logger.log(
      `Completed retranslation for assignment ${assignmentId}, languages: ${languageCodes.join(
        ", ",
      )}`,
    );
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

    // Track job start time for timeout monitoring
    if (jobId) {
      this.jobStartTimes.set(jobId, Date.now());
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

    await this.syncLimiterForTranslationModel();
    const results = await this.processBatchesInParallel(
      supportedLanguages,
      async (lang: string) => {
        try {
          // Check for job cancellation
          if (jobId && this.isJobCancelled(jobId)) {
            this.logger.warn(
              `Job ${jobId} cancelled, stopping translation for ${lang}`,
            );
            return false;
          }

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

    // Clean up job tracking
    if (jobId) {
      this.cleanupCancelledJob(jobId);
    }
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
    forceRetranslation = false,
  ): Promise<void> {
    const hasValidJobId = jobId && jobId > 0;

    if (!this.languageTranslation) {
      if (hasValidJobId) {
        await this.jobStatusService.updateJobStatus(jobId, {
          status: "Completed",
          progress: `Translation skipped for question #${questionId} (disabled in development mode)`,
          percentage: 100,
        });
      }
      return;
    }

    // Track job start time only for valid job IDs
    if (hasValidJobId) {
      this.jobStartTimes.set(jobId, Date.now());
    }

    // Don't interfere with main job progress - let parent job handle progress updates

    const normalizedText = question.question.trim();
    const normalizedChoices = question.choices ?? null;

    let questionLang = "en";
    try {
      const detectedLang = await this.llmFacadeService.getLanguageCode(
        normalizedText,
        assignmentId,
      );
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

    // Only delete existing translations if content has changed or forced
    if (forceRetranslation) {
      await this.prisma.translation.deleteMany({
        where: {
          questionId: questionId,
          variantId: null,
        },
      });
    } else {
      // Check if translations already exist for this question
      const existingTranslations = await this.prisma.translation.findMany({
        where: {
          questionId: questionId,
          variantId: null,
        },
        select: { languageCode: true },
      });

      const existingLanguages = new Set(
        existingTranslations.map((t) => t.languageCode),
      );
      const missingLanguages = supportedLanguages.filter(
        (lang) => !existingLanguages.has(lang),
      );

      if (missingLanguages.length === 0) {
        // All translations already exist - no need to retranslate
        if (hasValidJobId) {
          this.cleanupCancelledJob(jobId);
        }
        return;
      }
    }

    await this.syncLimiterForTranslationModel();
    const results = await this.processBatchesInParallel(
      supportedLanguages,
      async (lang: string) => {
        try {
          if (progressTracker) {
            await this.updateJobProgress(
              progressTracker,
              getLanguageNameFromCode(lang),
              undefined,
              lang === questionLang
                ? "Storing original content"
                : "Checking for existing translation",
            );
          }

          await this.generateAndStoreTranslation(
            assignmentId,
            questionId,
            null,
            normalizedText,
            normalizedChoices,
            questionLang,
            lang,
          );

          if (progressTracker) {
            this.incrementLanguageCompleted(progressTracker);
            await this.updateJobProgress(
              progressTracker,
              getLanguageNameFromCode(lang),
              undefined,
              lang === questionLang
                ? "Original stored ✓"
                : "Translation completed ✓",
            );
          }

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

    // Question translation complete - parent job will handle final status updates
    if (hasValidJobId) {
      // Clean up job tracking
      this.cleanupCancelledJob(jobId);
    }

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
    forceRetranslation = false,
  ): Promise<void> {
    const hasValidJobId = jobId && jobId > 0;

    if (!this.languageTranslation) {
      if (hasValidJobId) {
        await this.jobStatusService.updateJobStatus(jobId, {
          status: "Completed",
          progress: `Translation skipped for variant #${variantId} (disabled in development mode)`,
          percentage: 100,
        });
      }
      return;
    }

    // Track job start time only for valid job IDs
    if (hasValidJobId) {
      this.jobStartTimes.set(jobId, Date.now());
    }
    // Don't interfere with main job progress - let parent job handle progress updates

    const normalizedText = variant.variantContent.trim();
    const normalizedChoices = variant.choices ?? null;

    // Check if translations already exist for this variant (unless forced)
    if (!forceRetranslation) {
      const existingTranslations = await this.prisma.translation.findMany({
        where: {
          questionId: questionId,
          variantId: variantId,
        },
        select: { languageCode: true },
      });

      const supportedLanguages = getAllLanguageCodes() ?? ["en"];
      const existingLanguages = new Set(
        existingTranslations.map((t) => t.languageCode),
      );
      const missingLanguages = supportedLanguages.filter(
        (lang) => !existingLanguages.has(lang),
      );

      if (missingLanguages.length === 0) {
        // Variant already translated - let parent job handle progress
        return;
      }
    }

    let variantLang = "en";
    try {
      const detectedLang = await this.llmFacadeService.getLanguageCode(
        normalizedText,
        assignmentId,
      );
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

    // Only delete existing translations if content has changed (forceRetranslation = true)
    if (forceRetranslation) {
      await this.prisma.translation.deleteMany({
        where: {
          questionId: questionId,
          variantId: variantId,
        },
      });
    }

    await this.syncLimiterForTranslationModel();
    const results = await this.processBatchesInParallel(
      supportedLanguages,
      async (lang: string) => {
        try {
          if (progressTracker) {
            await this.updateJobProgress(
              progressTracker,
              getLanguageNameFromCode(lang),
              undefined,
              lang === variantLang
                ? "Storing original content"
                : "Checking for existing translation",
            );
          }

          await this.generateAndStoreTranslation(
            assignmentId,
            questionId,
            variantId,
            normalizedText,
            normalizedChoices,
            variantLang,
            lang,
          );

          if (progressTracker) {
            this.incrementLanguageCompleted(progressTracker);
            await this.updateJobProgress(
              progressTracker,
              getLanguageNameFromCode(lang),
              undefined,
              lang === variantLang
                ? "Original stored ✓"
                : "Translation completed ✓",
            );
          }

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

    // Variant translation complete - parent job will handle final status updates
    if (hasValidJobId) {
      // Clean up job tracking
      this.cleanupCancelledJob(jobId);
    }

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

    try {
      await Promise.all(translationPromises);

      // Only create assignment translation if all fields were translated successfully
      await this.prisma.assignmentTranslation.upsert({
        where: {
          assignmentId_languageCode: {
            assignmentId: assignment.id,
            languageCode: lang,
          },
        },
        update: {
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
        create: {
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
    } catch (translationError: unknown) {
      const errorMessage =
        translationError instanceof Error
          ? translationError.message
          : String(translationError);
      this.logger.warn(
        `Skipping assignment translation creation for ${lang} due to translation failure for assignment ${assignment.id}: ${errorMessage}`,
      );
      // Don't create assignment translation for this language
      throw translationError;
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
   * Enhanced with better source language handling and context awareness
   */
  private async generateAndStoreTranslation(
    assignmentId: number,
    questionId: number,
    variantId: number | null,
    originalText: string,
    originalChoices: Choice[] | null | string | any,
    sourceLanguage: string,
    targetLanguage: string,
  ): Promise<void> {
    // Parse originalChoices if it's a string (from database JSON)
    let parsedChoices: Choice[] | null = null;
    if (originalChoices) {
      if (typeof originalChoices === "string") {
        try {
          parsedChoices = JSON.parse(originalChoices) as Choice[];
        } catch (error) {
          this.logger.error(`Failed to parse choices JSON: ${String(error)}`);
          parsedChoices = null;
        }
      } else if (Array.isArray(originalChoices)) {
        parsedChoices = originalChoices as Choice[];
      } else {
        // Handle case where originalChoices is some other type
        this.logger.warn(
          `Unexpected type for originalChoices: ${typeof originalChoices}`,
        );
        parsedChoices = null;
      }
    }
    // Check if we need to reuse existing translation
    // Only reuse if it's from the same assignment (context-aware)
    // const existingTranslation = await this.prisma.translation.findFirst({
    //   where: {
    //     question: {
    //       assignmentId: assignmentId, // Same assignment context
    //     },
    //     languageCode: targetLanguage,
    //     untranslatedText: originalText,
    //     untranslatedChoices: { equals: this.prepareJsonValue(originalChoices) },
    //   },
    //   orderBy: { createdAt: "desc" },
    // });

    // if (existingTranslation) {
    //   // Reuse existing translation for this exact content
    //   try {
    //     await this.prisma.translation.create({
    //       data: {
    //         questionId,
    //         variantId,
    //         languageCode: targetLanguage,
    //         untranslatedText: originalText,
    //         untranslatedChoices: this.prepareJsonValue(originalChoices),
    //         translatedText: existingTranslation.translatedText, // Reuse existing translation
    //         translatedChoices: existingTranslation.translatedChoices,
    //       },
    //     });
    //   } catch (createError) {
    //     // Check if record now exists due to race condition
    //     const existingRecord = await this.prisma.translation.findFirst({
    //       where: {
    //         questionId,
    //         variantId,
    //         languageCode: targetLanguage,
    //       },
    //     });

    //     if (!existingRecord) {
    //       // If still no existing record, re-throw the original error
    //       throw createError;
    //     }
    //     // If record exists now, silently continue (race condition resolved)
    //   }
    //   return;
    // }

    // No existing translation found - generate new one
    if (sourceLanguage.toLowerCase() === targetLanguage.toLowerCase()) {
      // Same language - store original content
      try {
        await this.prisma.translation.create({
          data: {
            questionId,
            variantId,
            languageCode: targetLanguage,
            untranslatedText: originalText,
            untranslatedChoices: this.prepareJsonValue(parsedChoices),
            translatedText: originalText,
            translatedChoices: this.prepareJsonValue(originalChoices),
          },
        });
      } catch (createError) {
        // Check if record now exists due to race condition
        const existingRecord = await this.prisma.translation.findFirst({
          where: {
            questionId,
            variantId,
            languageCode: targetLanguage,
          },
        });

        if (!existingRecord) {
          // If still no existing record, re-throw the original error
          throw createError;
        }
        // If record exists now, silently continue (race condition resolved)
      }
      return;
    }

    // Different language - translate it
    const translationPromises: Array<Promise<any>> = [];
    let translatedText: string = originalText;
    let translatedChoices: Choice[] | null = parsedChoices;

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
    if (
      parsedChoices &&
      Array.isArray(parsedChoices) &&
      parsedChoices.length > 0
    ) {
      translationPromises.push(
        this.executeWithOptimizedRetry(
          `translateChoices-${questionId}-${targetLanguage}`,
          () =>
            this.llmFacadeService.generateChoicesTranslation(
              parsedChoices,
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
            return parsedChoices;
          }),
      );
    }

    try {
      await Promise.all(translationPromises);

      // Create new translation record only if all translations succeeded
      try {
        await this.prisma.translation.create({
          data: {
            questionId,
            variantId,
            languageCode: targetLanguage,
            untranslatedText: originalText,
            untranslatedChoices: this.prepareJsonValue(parsedChoices),
            translatedText,
            translatedChoices: this.prepareJsonValue(translatedChoices),
          },
        });
      } catch (createError) {
        // Check if record now exists due to race condition
        const existingRecord = await this.prisma.translation.findFirst({
          where: {
            questionId,
            variantId,
            languageCode: targetLanguage,
          },
        });

        if (!existingRecord) {
          // If still no existing record, re-throw the original error
          throw createError;
        }
        // If record exists now, silently continue (race condition resolved)
        this.logger.debug(
          `Translation record already exists for question ${questionId} in ${targetLanguage} (race condition resolved)`,
        );
      }
    } catch (translationError) {
      // If any translation failed, don't create the translation record
      // This language will not be available for this question/variant
      this.logger.warn(
        `Skipping translation record creation for ${targetLanguage} due to translation failure for question ${questionId}${
          variantId ? ` variant ${variantId}` : ""
        }`,
      );
      throw translationError;
    }
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
