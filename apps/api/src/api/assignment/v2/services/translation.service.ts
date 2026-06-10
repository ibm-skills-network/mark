/* eslint-disable unicorn/no-null */
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import Bottleneck from "bottleneck";
import IORedis from "ioredis";
import { LLMResolverService } from "src/api/llm/core/services/llm-resolver.service";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import { LLM_RESOLVER_SERVICE } from "src/api/llm/llm.constants";
import { PrismaService } from "src/database/prisma.service";
import { createRedisConnection } from "src/job-queue/redis.connection";
import {
  decrementInflightLanguage,
  seedInflightLanguages,
} from "../../attempt/translation-state-redis";
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
import type { PerJobTranslationEntry } from "./publish-job-result.types";

// Per-publish translation status hash key. The publish job HGETALLs this on
// each poll tick to aggregate per-job translation progress for the SSE
// stream. Each worker writes only its OWN field on the hash
// (`<kind>:<id>`), so workers never contend with each other and the
// publish job is the single reader/aggregator.
const buildPublishHashKey = (parentJobId: string): string =>
  `mark:publish:${parentJobId}:translations`;

// 1-hour TTL fallback. If the publish poll loop dies before it can DEL the
// hash on terminal exit, the key auto-clears after the TTL expires. The
// per-publish jobId in the key means key collisions are structurally
// impossible across concurrent publishes of the same assignment.
const PUBLISH_HASH_TTL_SECONDS = 3600;

// Supported language codes accessor. Lazily resolved on first call to avoid
// running getAllLanguageCodes() at module-init time — doing so trips a
// circular-import edge in the v2 services graph and breaks any test that
// loads translation.service.ts through the NestJS Test module. The
// throttle math on the mid-loop HSET writes uses `.length` against this
// accessor so a future expansion of the language matrix only changes the
// source-of-truth in languages.json.
const getSupportedLanguageCount = (): number =>
  (getAllLanguageCodes() ?? ["en"]).length;

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
  jobId: string;
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

// Per-language row payload produced by generateTranslation. Caller
// collects these from a parallel fan-out, then issues one bulk INSERT
// per question/variant/meta job — replaces the previous 23-round-trip
// per-language INSERT loop.
interface TranslationInsertRow {
  questionId: number;
  variantId: number | null;
  languageCode: string;
  translatedText: string;
  untranslatedText: string | null;
  translatedChoices: Choice[] | null;
  untranslatedChoices: Choice[] | null;
}

// Three-bucket per-language outcome counters returned by the public
// translate methods. `inserted` = rows actually written by the bulk
// INSERT; `skipped` = rows offered to the INSERT that hit ON CONFLICT
// DO NOTHING (the row was already present); `failed` = languages whose
// LLM call returned no row. This split is what makes a re-publish of
// already-translated content distinguishable in logs from a real
// failure — the prior {success, failure} pair conflated the two.
export interface TranslationOutcome {
  inserted: number;
  skipped: number;
  failed: number;
}

/**
 * Service for handling translations of assignments, questions, and variants
 * Optimized for performance with parallel processing
 */
@Injectable()
export class TranslationService implements OnModuleDestroy {
  private readonly logger = new Logger(TranslationService.name);
  private readonly _languageTranslation: boolean;

  /**
   * Whether language translation is enabled in this deployment. Producers
   * (publish + PATCH flows) check this before enqueuing TRANSLATE_QUESTION
   * / TRANSLATE_VARIANT / TRANSLATE_META jobs and before marking pending
   * status entries on the per-publish hash. When false, the translate
   * methods short-circuit early and never write terminal status, so any
   * pending entry that slipped through would leave the publish poll loop
   * spinning for the full 30-minute timeout.
   */
  public get languageTranslation(): boolean {
    return this._languageTranslation;
  }
  private limiter: Bottleneck;
  private watsonxLimiter: Bottleneck;
  private useWatsonxLimiterForTranslation = false;
  private isResettingLimiter = false;

  private readonly MAX_BATCH_SIZE = 100;
  // 200 concurrent ops in the default (OpenAI) limiter so worker-pool fan-out
  // (8 workers x 23 languages = 184 ops per publish) can run fully concurrent
  // instead of queueing 134-deep behind a 50-wide cap. The reservoir
  // (500 ops per 3s = ~166/s) is still in place as a soft safety belt under
  // OpenAI's per-account rate limit.
  private readonly CONCURRENCY_LIMIT = 200;
  // 3 attempts (initial + 2 retries) with a constant 5s pause between
  // failures. Smooths transient LLM/network hiccups so per-language failures
  // do not surface to authors on the first flake. The pause is constant
  // (not exponential) to keep the perceived "retrying..." window predictable.
  private readonly MAX_RETRY_ATTEMPTS = 3;
  private readonly RETRY_DELAY_BASE = 5000;
  private readonly STATUS_UPDATE_INTERVAL = 20;
  // 90s per-call timeout. Bumped from 30s because choice-translation hits the
  // back of the Bottleneck queue under worker-pool concurrency: each question
  // produces ~2 ops per language × 23 languages, and with 8 workers all calling
  // simultaneously the limiter queue grows past 30s of LLM round-trip latency.
  private readonly OPERATION_TIMEOUT = 90_000;
  // Limiter expiration for one scheduled fan-out operation. The scheduled
  // operation wraps the WHOLE per-language retry loop — MAX_RETRY_ATTEMPTS
  // attempts of up to OPERATION_TIMEOUT each, plus the doubled inter-attempt
  // pauses for timeouts — so the expiration must cover that full budget
  // (~300s), plus slack for jitter. When this matched a single attempt
  // (90s), the first slow LLM call burned the entire window, Bottleneck
  // rejected the operation, and the retries never ran: every publish with
  // enough concurrent calls lost 1-2 languages at exactly the 90s mark.
  // Worst-case per-language time exceeds the 120s BullMQ lockDuration on
  // the translations queue; that is fine while the event loop stays
  // responsive, because the worker auto-renews its lock every
  // lockDuration/2. If the event loop stalls past the lock window the job
  // fails permanently — the translations queue runs maxStalledCount=0, so
  // there is NO stall redelivery — and recovery is the author-facing
  // Retry, which re-runs with forceRetranslation: false and fills only
  // the missing languages.
  // Assigned in the constructor rather than via a field initializer: an
  // initializer reading sibling fields silently evaluates to NaN if the
  // constant declarations above are ever reordered below this one.
  private readonly FANOUT_OPERATION_EXPIRATION: number;
  private readonly JOB_TIMEOUT = 600_000;
  private readonly MAX_STUCK_OPERATIONS = 15;

  private stuckOperations = new Set<string>();
  private jobStartTimes = new Map<string, number>();
  private jobCancellationFlags = new Map<string, boolean>();
  private readonly limiterHealthInterval: NodeJS.Timeout;
  private readonly jobTimeoutInterval: NodeJS.Timeout;
  // Dedicated IORedis connection used for per-language refcount decrements
  // on the per-assignment in-flight hash and for per-publish status HSETs.
  private readonly translationStateRedis: IORedis | undefined;
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
    this._languageTranslation =
      process.env.ENABLE_TRANSLATION?.toString().toLowerCase() === "true";

    this.FANOUT_OPERATION_EXPIRATION =
      this.OPERATION_TIMEOUT * this.MAX_RETRY_ATTEMPTS +
      this.RETRY_DELAY_BASE * 2 * (this.MAX_RETRY_ATTEMPTS - 1) +
      10_000;

    this.limiter = this.createDefaultLimiter();
    this.watsonxLimiter = this.createWatsonxLimiter();
    this.limiterHealthInterval = setInterval(
      () => this.checkLimiterHealth(),
      30_000,
    );
    this.jobTimeoutInterval = setInterval(
      () => this.checkJobTimeouts(),
      60_000,
    );
    this.translationStateRedis = this.tryCreateTranslationStateRedis();
  }

  // Wrap createRedisConnection() in try/catch so missing REDIS_URL (or any
  // boot-time Redis failure) degrades gracefully instead of bringing down
  // DI. Status-tracking sites become no-ops; translation work still runs.
  private tryCreateTranslationStateRedis(): IORedis | undefined {
    try {
      const client = createRedisConnection();
      client.on("error", (error) => {
        this.logger.warn(
          `Translation status Redis error (status tracking disabled): ${error.message}`,
        );
      });
      return client;
    } catch (error) {
      this.logger.warn(
        `Translation status Redis unavailable — status tracking disabled: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.limiterHealthInterval);
    clearInterval(this.jobTimeoutInterval);
    void this.limiter.disconnect().catch(() => null);
    void this.watsonxLimiter.disconnect().catch(() => null);
    await this.translationStateRedis?.quit().catch(() => null);
  }

  /**
   * Decrement a single language's in-flight refcount for the assignment.
   *
   * Called by every per-language terminal path (success or failure) inside
   * the fan-out loops so the learner-side resolver can transition a
   * pending marker either to a real translation row (if one landed) or
   * to "unavailable" (when every worker for the language has finished
   * without a corresponding row).
   *
   * A Redis blip is logged and swallowed — it does not constitute a
   * translation failure. The 30-minute TTL fallback on the hash eventually
   * clears stuck counters regardless.
   */
  /**
   * Seed a "pending" entry on the per-publish translation status hash
   * for an enqueued translation job. Called by producers (publish flow)
   * AT enqueue time so the publish poll loop's first SSE tick already
   * carries every entry the user will eventually see.
   *
   * Uses HSETNX (set-if-not-exists) rather than HSET because Bull may
   * dispatch a worker fast enough that the worker's initial-enter HSET
   * lands BEFORE this call. With HSET we'd overwrite the worker's
   * `in_progress` value back to `pending`, and the user would see the
   * row's text bounce between "Translating · N/23 languages" and
   * "Queued". HSETNX makes "first writer wins on creation": the worker
   * is never reverted, and the pending entry is only the visible state
   * if markPending got there first.
   */
  async markPending(
    parentJobId: string,
    kind: "question" | "variant" | "meta",
    id: number,
  ): Promise<void> {
    if (!this.translationStateRedis) return;
    const entry: PerJobTranslationEntry = {
      kind,
      id,
      status: "pending",
      languagesCompleted: 0,
      languagesTotal: getSupportedLanguageCount(),
    };
    try {
      await this.translationStateRedis.hsetnx(
        buildPublishHashKey(parentJobId),
        `${kind}:${id}`,
        JSON.stringify(entry),
      );
      await this.translationStateRedis.expire(
        buildPublishHashKey(parentJobId),
        PUBLISH_HASH_TTL_SECONDS,
      );
    } catch (hsetError) {
      const errorMessage =
        hsetError instanceof Error ? hsetError.message : String(hsetError);
      this.logger.warn("publish.translation.job.pending.hset.failed", {
        parentJobId,
        kind,
        id,
        error: errorMessage,
      });
    }
  }

  async markPublishTranslationFailed(
    parentJobId: string,
    kind: "question" | "variant" | "meta",
    id: number,
  ): Promise<void> {
    if (!this.translationStateRedis) return;
    const entry: PerJobTranslationEntry = {
      kind,
      id,
      status: "failed",
      languagesCompleted: 0,
      languagesTotal: getSupportedLanguageCount(),
    };
    try {
      const key = buildPublishHashKey(parentJobId);
      await this.translationStateRedis.hset(
        key,
        `${kind}:${id}`,
        JSON.stringify(entry),
      );
      await this.translationStateRedis.expire(key, PUBLISH_HASH_TTL_SECONDS);
    } catch {
      // Best-effort: caller rethrows the original error regardless.
    }
  }

  async seedOneInflightJob(assignmentId: number): Promise<void> {
    if (!this.translationStateRedis) return;
    const codes = getAllLanguageCodes();
    if (codes.length === 0) return;
    await seedInflightLanguages(
      this.translationStateRedis,
      assignmentId,
      codes,
      1,
    );
  }

  async rollbackOneInflightSeed(assignmentId: number): Promise<void> {
    if (!this.translationStateRedis) return;
    const codes = getAllLanguageCodes();
    if (codes.length === 0) return;
    await this.releaseInflightLanguages(assignmentId, codes);
  }

  /**
   * Terminal status for a publish-hash entry after a fan-out run.
   * While BullMQ attempts remain the executor rethrows on partial failure
   * and a retry will fill the missing languages, so the entry stays
   * in_progress — "failed" is reserved for the final attempt
   * (markTerminalFailure), where it is what the author actually sees.
   */
  private terminalEntryStatus(
    failed: number,
    markTerminalFailure: boolean,
  ): PerJobTranslationEntry["status"] {
    if (failed === 0) return "completed";
    return markTerminalFailure ? "failed" : "in_progress";
  }

  private async markPublishTranslationCompleted(
    parentJobId: string | undefined,
    kind: "question" | "variant" | "meta",
    id: number,
    languagesCompleted: number,
  ): Promise<void> {
    if (!parentJobId || !this.translationStateRedis) return;
    const entry: PerJobTranslationEntry = {
      kind,
      id,
      status: "completed",
      languagesCompleted,
      languagesTotal: getSupportedLanguageCount(),
    };
    try {
      const key = buildPublishHashKey(parentJobId);
      await this.translationStateRedis.hset(
        key,
        `${kind}:${id}`,
        JSON.stringify(entry),
      );
      await this.translationStateRedis.expire(key, PUBLISH_HASH_TTL_SECONDS);
    } catch {
      // Best-effort: caller still drains in-flight counters below.
    }
  }

  private async releaseInflightLanguages(
    assignmentId: number,
    languages: string[],
  ): Promise<void> {
    await Promise.all(
      languages.map((language) =>
        this.releaseInflightLanguage(assignmentId, language),
      ),
    );
  }

  private async markPreFanoutTranslationFailed(
    parentJobId: string | undefined,
    kind: "question" | "variant" | "meta",
    id: number,
    assignmentId: number,
    languages: string[],
    markTerminalFailure: boolean,
  ): Promise<void> {
    if (!markTerminalFailure) return;
    if (parentJobId) {
      await this.markPublishTranslationFailed(parentJobId, kind, id);
    }
    await this.releaseInflightLanguages(assignmentId, languages);
  }

  private async releaseInflightLanguage(
    assignmentId: number,
    languageCode: string,
  ): Promise<void> {
    if (!this.translationStateRedis) return;
    try {
      await decrementInflightLanguage(
        this.translationStateRedis,
        assignmentId,
        languageCode,
      );
    } catch (decrError) {
      const errorMessage =
        decrError instanceof Error ? decrError.message : String(decrError);
      this.logger.warn(
        `publish.translation.inflight.decrement.failed { assignmentId: ${assignmentId}, languageCode: ${languageCode}, error: ${errorMessage} }`,
      );
    }
  }

  private createDefaultLimiter(): Bottleneck {
    return new Bottleneck({
      maxConcurrent: this.CONCURRENCY_LIMIT,
      minTime: 2,
      reservoirRefreshInterval: 3000,
      reservoirRefreshAmount: 500,
      highWater: 5000,
      strategy: Bottleneck.strategy.OVERFLOW,
      timeout: this.OPERATION_TIMEOUT,
    });
  }

  private createWatsonxLimiter(): Bottleneck {
    return new Bottleneck({
      maxConcurrent: 8,
      minTime: 50,
      reservoir: 20,
      reservoirRefreshInterval: 1000,
      reservoirRefreshAmount: 20,
      highWater: 1000,
      strategy: Bottleneck.strategy.OVERFLOW,
      timeout: this.OPERATION_TIMEOUT,
    });
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
          `Translation limiter set to ${
            isWatsonx ? "Watsonx profile" : "default profile"
          } (model: ${modelKey})`,
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

  private isLimiterStoppedError(error: unknown): boolean {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return errorMessage.includes("has been stopped and cannot accept new jobs");
  }

  private async scheduleOnActiveLimiter<T>(
    operationName: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    // Per-job expiration must accommodate the FULL retry budget of the
    // scheduled operation, not a single attempt — see the comment on
    // FANOUT_OPERATION_EXPIRATION. Two prior incarnations of this bug:
    // 15s expired ops still in the Bottleneck queue under load, and 90s
    // (== one attempt's timeout) killed the operation the moment its first
    // attempt ran long, so the retry layer never executed.
    const scheduleOptions = {
      expiration: this.FANOUT_OPERATION_EXPIRATION,
      priority: 5,
    } as const;

    try {
      return await this.getActiveLimiter().schedule(scheduleOptions, operation);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (this.isLimiterStoppedError(error)) {
        this.logger.warn(
          `Limiter was stopped while scheduling ${operationName}. Recreating limiter and retrying once.`,
        );
        this.resetLimiter();
        return this.getActiveLimiter().schedule(scheduleOptions, operation);
      }

      // Bottleneck rejections (expiration timeout, OVERFLOW strategy drop)
      // were previously swallowed by the .catch in processBatchesInParallel
      // and only contributed to the failure counter. Surface them so
      // operators can correlate "X failed" results with the actual cause.
      this.logger.warn(`Bottleneck rejected ${operationName}: ${errorMessage}`);
      throw error;
    }
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
    void _concurrencyLimit;
    const results: BatchProcessResult = { success: 0, failure: 0, dropped: 0 };
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += batchSize) {
      chunks.push(items.slice(index, index + batchSize));
    }

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];

      // The .catch returns a sentinel so the post-loop filter counts each
      // outcome exactly once. The previous shape both incremented
      // results.failure inside the catch AND counted the returned `false`
      // again via the filter, surfacing a single real failure as "2
      // failed" on the publish progress UI.
      const DROPPED = Symbol("dropped");
      const FAILED = Symbol("failed");
      type ChunkOutcome = boolean | typeof DROPPED | typeof FAILED;

      const processingPromises = chunk.map(
        (item): Promise<ChunkOutcome> =>
          this.scheduleOnActiveLimiter(
            `processBatchesInParallel-${String(chunkIndex)}`,
            () => batchProcessor(item),
          ).catch((error): ChunkOutcome => {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            return errorMessage.includes("dropped") ? DROPPED : FAILED;
          }),
      );

      const chunkResults = await Promise.all(processingPromises);

      for (const r of chunkResults) {
        switch (r) {
          case true: {
            results.success++;
            break;
          }
          case DROPPED: {
            results.dropped++;
            break;
          }
          default: {
            // `false` and the FAILED sentinel land here.
            results.failure++;
          }
        }
      }

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
      const recentTranslationsCount =
        await this.prisma.assignmentTranslation.count({
          where: {
            assignmentId,
            updatedAt: {
              gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
            },
          },
        });

      if (recentTranslationsCount > 0) {
        return true;
      }

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
      return true;
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
    if (languageCode.toLowerCase() === "en") {
      return true;
    }

    const assignmentTranslation =
      await this.prisma.assignmentTranslation.findFirst({
        where: { assignmentId, languageCode },
      });

    if (!assignmentTranslation) {
      return false;
    }

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
      return true;
    }

    const questionIds = questions.map((q) => q.id);
    const variantIds = questions.flatMap((q) => q.variants.map((v) => v.id));
    const requiredCount = questionIds.length + variantIds.length;

    if (requiredCount === 0) {
      return true;
    }

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
   * Detect if the limiter appears to be stalled and reset it if necessary.
   *
   * The genuine stall signal is "lots received, lots running, almost
   * nothing finishing" — which means Bottleneck has wedged and ops are
   * piling up without progress. Recreating the limiter is the only way
   * out of that state. This is the load-bearing protection here.
   *
   * A prior version of this method also throttled maxConcurrent from
   * 200 → 5 whenever QUEUED > 500 (and restored to 25, not 200, so each
   * firing permanently halved the limiter's ceiling). For any publish
   * larger than ~12 questions the queue normally crosses 500 during the
   * parallel fan-out window — the throttle then starved the queue, the
   * 90s OPERATION_TIMEOUT killed ops sitting behind only 5 active slots,
   * `executeWithOptimizedRetry` re-scheduled them onto the same throttled
   * limiter, and the retries timed out too. Net effect: deterministic
   * mid-publish failures on every assignment >~12 questions, "fixed" only
   * by the author clicking Retry (which re-runs the small set of failed
   * languages — a load small enough not to re-trip the threshold).
   *
   * Overload is already constrained by the other layers configured on
   * the limiter: maxConcurrent=200 caps simultaneous LLM calls, the
   * reservoir caps sustained TPS at ~166/s, highWater=5000 with
   * strategy.OVERFLOW rejects new schedules past the queue ceiling, and
   * TRANSLATION_CONCURRENCY=8 caps inflow at the BullMQ layer. The
   * throttle was a redundant fifth layer that got the numbers wrong.
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
    if (this.isResettingLimiter) {
      return;
    }

    try {
      this.isResettingLimiter = true;
      this.logger.warn(
        "Recreating translation limiters due to potential stalled/stopped state",
      );

      const previousDefaultLimiter = this.limiter;
      const previousWatsonxLimiter = this.watsonxLimiter;

      this.limiter = this.createDefaultLimiter();
      this.watsonxLimiter = this.createWatsonxLimiter();

      void previousDefaultLimiter
        .stop({ dropWaitingJobs: true })
        .catch(() => null)
        .finally(() => {
          void previousDefaultLimiter.disconnect().catch(() => null);
        });
      void previousWatsonxLimiter
        .stop({ dropWaitingJobs: true })
        .catch(() => null)
        .finally(() => {
          void previousWatsonxLimiter.disconnect().catch(() => null);
        });

      this.logger.log("Translation limiters were recreated");
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error resetting limiter: ${errorMessage}`);
    } finally {
      this.isResettingLimiter = false;
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
    jobId: string,
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
    _jobId?: string,
  ): Promise<T> {
    void _jobId;
    let attempts = 0;
    const operationId = `${operationName}-${Date.now()}`;

    while (attempts < maxAttempts) {
      try {
        this.stuckOperations.add(operationId);

        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(
              new Error(
                `Operation ${operationName} timed out after ${this.OPERATION_TIMEOUT}ms`,
              ),
            );
          }, this.OPERATION_TIMEOUT);
        });

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

        const isTimeout = errorMessage.includes("timed out");

        if (attempts >= maxAttempts) {
          this.logger.error(
            `Failed ${operationName} after ${maxAttempts} attempts: ${errorMessage}`,
          );

          if (isTimeout) {
            this.handleStuckOperation(operationName);
          }

          throw error;
        }

        const baseDelay = isTimeout
          ? this.RETRY_DELAY_BASE * 2
          : this.RETRY_DELAY_BASE;
        const jitter = Math.random() * 200;
        await new Promise((resolve) => setTimeout(resolve, baseDelay + jitter));
      }
    }

    throw new Error(`Max retries exceeded for ${operationName}`);
  }

  /**
   * Handle stuck operations by resetting limiter if needed
   */
  private handleStuckOperation(_operationName: string): void {
    void _operationName;
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
  async cancelJob(jobId: string): Promise<void> {
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
  private isJobCancelled(jobId?: string): boolean {
    if (!jobId) return false;
    return this.jobCancellationFlags.get(jobId) === true;
  }

  /**
   * Clean up cancelled job resources
   */
  private cleanupCancelledJob(jobId: string): void {
    this.jobCancellationFlags.delete(jobId);
    this.jobStartTimes.delete(jobId);
  }

  /**
   * Check for jobs that have exceeded the timeout and cancel them
   */
  private checkJobTimeouts(): void {
    const now = Date.now();
    const expiredJobs: string[] = [];

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
   * Translate assignment metadata for specific languages without deleting question translations.
   */
  async translateAssignmentForLanguages(
    assignmentId: number,
    languageCodes: string[],
  ): Promise<void> {
    if (languageCodes.length === 0) {
      return;
    }

    if (!this._languageTranslation) {
      this.logger.log("Translation is disabled in development mode");
      return;
    }

    this.checkLimiterHealth();

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

    await this.syncLimiterForTranslationModel();
    const results = await this.processBatchesInParallel(
      languageCodes,
      async (lang: string) => {
        try {
          await this.translateAssignmentToLanguage(
            assignment as unknown as GetAssignmentResponseDto,
            lang,
          );
          return true;
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Failed to translate assignment ${assignmentId} to ${lang}: ${errorMessage}`,
          );
          return false;
        }
      },
      this.MAX_BATCH_SIZE,
      this.CONCURRENCY_LIMIT,
    );

    this.logger.log(
      `Assignment #${assignmentId} translation results for ${languageCodes.length} languages: ${results.success} successful, ${results.failure} failed, ${results.dropped} dropped/retried`,
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
    jobId?: string,
    progressRange?: { start: number; end: number },
    markTerminalFailure = false,
  ): Promise<TranslationOutcome> {
    if (!this._languageTranslation) {
      this.logger.log("Translation is disabled in development mode");
      if (jobId && progressRange) {
        await this.jobStatusService.updateJobStatus(jobId, {
          status: "In Progress",
          progress: "Translation skipped (disabled in development mode)",
          percentage: progressRange.end - 5,
        });
      }
      return { inserted: 0, skipped: 0, failed: 0 };
    }

    if (jobId) {
      this.jobStartTimes.set(jobId, Date.now());
    }

    const supportedLanguages = getAllLanguageCodes() ?? ["en"];
    const parentJobId = jobId;
    const start = progressRange?.start || 0;
    const end = progressRange?.end || 100;
    const range = end - start;
    let assignment!: GetAssignmentResponseDto | LearnerGetAssignmentResponseDto;
    let progressTracker: ProgressTracker | undefined;

    try {
      this.checkLimiterHealth();

      assignment = (await this.prisma.assignment.findUnique({
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
          this.cleanupCancelledJob(jobId);
        }
        throw new NotFoundException(
          `Assignment with id ${assignmentId} not found`,
        );
      }

      if (jobId) {
        await this.jobStatusService.updateJobStatus(jobId, {
          status: "In Progress",
          progress: "Preparing assignment translation",
          percentage: start + Math.floor(range * 0.1),
        });
      }

      progressTracker = jobId
        ? this.initializeProgressTracker(
            jobId,
            Math.ceil(supportedLanguages.length / this.MAX_BATCH_SIZE),
            start + Math.floor(range * 0.2),
            start + Math.floor(range * 0.9),
            "Translating assignment",
            supportedLanguages.length,
          )
        : undefined;

      // Write the per-job entry on the publish-job's status hash so the
      // publish poll loop sees this work in flight. The parentJobId IS the
      // existing jobId parameter — no parallel parameter is introduced.
      // When jobId is absent (standalone updateAssignment path), the
      // publish-hash writes are skipped cleanly. A 1-hour TTL fallback is
      // set on first write so the hash auto-clears even if the publish
      // poll loop dies before its terminal DEL.
      if (parentJobId) {
        try {
          await this.translationStateRedis?.hset(
            buildPublishHashKey(parentJobId),
            `meta:${assignmentId}`,
            JSON.stringify({
              kind: "meta",
              id: assignmentId,
              status: "in_progress",
              languagesCompleted: 0,
              languagesTotal: getSupportedLanguageCount(),
            } satisfies PerJobTranslationEntry),
          );
          await this.translationStateRedis?.expire(
            buildPublishHashKey(parentJobId),
            PUBLISH_HASH_TTL_SECONDS,
          );
        } catch (hsetError) {
          const errorMessage =
            hsetError instanceof Error ? hsetError.message : String(hsetError);
          this.logger.warn("publish.translation.job.hset.failed", {
            assignmentId,
            kind: "meta",
            id: assignmentId,
            error: errorMessage,
          });
        }
      }

      await this.syncLimiterForTranslationModel();
    } catch (error) {
      await this.markPreFanoutTranslationFailed(
        parentJobId,
        "meta",
        assignmentId,
        assignmentId,
        supportedLanguages,
        markTerminalFailure,
      );
      throw error;
    }
    let completedLangCounter = 0;
    // Bottleneck `expiration` rejects its own promise but does NOT
    // cancel the underlying operation. See translateQuestion for the
    // full story; same race + same guard.
    let parallelDone = false;
    const results = await this.processBatchesInParallel(
      supportedLanguages,
      async (lang: string) => {
        try {
          if (jobId && this.isJobCancelled(jobId)) {
            this.logger.warn(
              `Job ${jobId} cancelled, stopping translation for ${lang}`,
            );
            return false;
          }

          // Gate every parent-job updateJobStatus write on !parallelDone.
          // Bottleneck's `expiration` rejects its outer promise but does
          // not cancel the underlying LLM call — a slow callback can fire
          // after the parallel section returns, and its updateJobProgress
          // would flip the parent publish back from Completed to
          // In Progress. Same defense already applied to mid-loop HSETs.
          if (progressTracker && jobId && !parallelDone) {
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

          if (progressTracker && !parallelDone) {
            this.incrementLanguageCompleted(progressTracker);
            await this.updateJobProgress(
              progressTracker,
              getLanguageNameFromCode(lang),
              undefined,
              "Completed",
            );
          }

          // Throttled mid-loop HSET. Bounds the Redis write rate from a
          // worst-case 23 writes/job-per-language down to ~7 by firing every
          // 5th language, on the final iteration, AND on the last 2 langs.
          // The last-2 cases stop the UI from sitting at 20/23 for the tail
          // latency (otherwise no update fires between 20 and 23).
          const c = ++completedLangCounter;
          if (
            parentJobId &&
            !parallelDone &&
            (c % 5 === 0 || c >= getSupportedLanguageCount() - 2)
          ) {
            try {
              await this.translationStateRedis?.hset(
                buildPublishHashKey(parentJobId),
                `meta:${assignmentId}`,
                JSON.stringify({
                  kind: "meta",
                  id: assignmentId,
                  status: "in_progress",
                  languagesCompleted: c,
                  languagesTotal: getSupportedLanguageCount(),
                } satisfies PerJobTranslationEntry),
              );
            } catch {
              // Mid-loop HSET is throttled and recoverable — the terminal
              // HSET below covers the case where mid-loop writes were lost.
            }
          }

          return true;
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Failed to translate assignment to ${lang}: ${errorMessage}`,
          );
          return false;
        } finally {
          // Per-language terminal exit (success OR failure) drains the
          // language from the per-assignment in-flight refcount hash so the
          // learner-side resolver can flip the pending marker.
          await this.releaseInflightLanguage(assignmentId, lang);
        }
      },
      this.MAX_BATCH_SIZE,
      this.CONCURRENCY_LIMIT,
    );
    parallelDone = true;

    if (jobId) {
      await this.jobStatusService.updateJobStatus(jobId, {
        status: "In Progress",
        progress: `Assignment translated to ${results.success} languages`,
        percentage: end,
      });
    }

    this.logger.log(
      `Assignment #${assignmentId} translation results: ${results.success} inserted, 0 skipped, ${results.failure} failed`,
    );

    // translateAssignment writes to AssignmentTranslation (not Translation),
    // and translateAssignmentToLanguage handles the upsert internally — so
    // there is no separate "row landed" vs "row already existed" signal at
    // this layer. Map results.success → inserted (languages where the
    // per-language closure returned true), skipped → 0 (no separable bucket
    // here), failed → results.failure. Same shape as translateQuestion /
    // translateVariant so the executor's destructuring is uniform.
    const outcome: TranslationOutcome = {
      inserted: results.success,
      skipped: 0,
      failed: results.failure,
    };

    if (parentJobId) {
      try {
        await this.translationStateRedis?.hset(
          buildPublishHashKey(parentJobId),
          `meta:${assignmentId}`,
          JSON.stringify({
            kind: "meta",
            id: assignmentId,
            status: this.terminalEntryStatus(
              outcome.failed,
              markTerminalFailure,
            ),
            languagesCompleted: outcome.inserted + outcome.skipped,
            languagesTotal: getSupportedLanguageCount(),
          } satisfies PerJobTranslationEntry),
        );
      } catch (hsetError) {
        const errorMessage =
          hsetError instanceof Error ? hsetError.message : String(hsetError);
        this.logger.warn("publish.translation.job.hset.terminal.failed", {
          assignmentId,
          kind: "meta",
          id: assignmentId,
          error: errorMessage,
        });
      }
    }

    if (jobId) {
      this.cleanupCancelledJob(jobId);
    }

    return outcome;
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
    jobId?: string,
    forceRetranslation = false,
    markTerminalFailure = true,
  ): Promise<TranslationOutcome> {
    const hasValidJobId = typeof jobId === "string" && jobId.length > 0;

    if (!this._languageTranslation) {
      if (hasValidJobId) {
        await this.jobStatusService.updateJobStatus(jobId, {
          status: "Completed",
          progress: `Translation skipped for question #${questionId} (disabled in development mode)`,
          percentage: 100,
        });
      }
      return { inserted: 0, skipped: 0, failed: 0 };
    }

    if (hasValidJobId) {
      this.jobStartTimes.set(jobId, Date.now());
    }

    const normalizedText = question.question.trim();
    const normalizedChoices = question.choices ?? null;
    let questionLang = "en";
    const supportedLanguages = getAllLanguageCodes() ?? ["en"];
    const parentJobId = hasValidJobId ? jobId : undefined;
    let progressTracker: ProgressTracker | undefined;
    let targetLanguages = supportedLanguages;
    let skippedLanguages: string[] = [];

    try {
      if (forceRetranslation) {
        await this.prisma.translation.deleteMany({
          where: {
            questionId: questionId,
            variantId: null,
          },
        });
      } else {
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
          await this.markPublishTranslationCompleted(
            parentJobId,
            "question",
            questionId,
            supportedLanguages.length,
          );
          await this.releaseInflightLanguages(assignmentId, supportedLanguages);
          if (hasValidJobId) {
            this.cleanupCancelledJob(jobId);
          }
          return { inserted: 0, skipped: supportedLanguages.length, failed: 0 };
        }

        skippedLanguages = supportedLanguages.filter((lang) =>
          existingLanguages.has(lang),
        );
        targetLanguages = missingLanguages;
      }

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

      if (hasValidJobId) {
        await this.jobStatusService.updateJobStatus(jobId, {
          status: "In Progress",
          progress: `Question #${questionId} detected as ${getLanguageNameFromCode(
            questionLang,
          )}. Preparing translations...`,
          percentage: 15,
        });
      }

      progressTracker = hasValidJobId
        ? this.initializeProgressTracker(
            jobId,
            Math.ceil(supportedLanguages.length / this.MAX_BATCH_SIZE),
            20,
            95,
            `Translating Question #${questionId}`,
            supportedLanguages.length,
          )
        : undefined;

      // Write the per-job entry on the publish-job's status hash so the
      // publish poll loop sees this work in flight. The parentJobId IS the
      // existing jobId parameter — no parallel parameter is introduced.
      // A 1-hour TTL fallback is set on first write so the hash auto-clears
      // even if the publish poll loop dies before its terminal DEL.
      if (parentJobId) {
        try {
          await this.translationStateRedis?.hset(
            buildPublishHashKey(parentJobId),
            `question:${questionId}`,
            JSON.stringify({
              kind: "question",
              id: questionId,
              status: "in_progress",
              languagesCompleted: skippedLanguages.length,
              languagesTotal: getSupportedLanguageCount(),
            } satisfies PerJobTranslationEntry),
          );
          await this.translationStateRedis?.expire(
            buildPublishHashKey(parentJobId),
            PUBLISH_HASH_TTL_SECONDS,
          );
        } catch (hsetError) {
          const errorMessage =
            hsetError instanceof Error ? hsetError.message : String(hsetError);
          this.logger.warn("publish.translation.job.hset.failed", {
            assignmentId,
            kind: "question",
            id: questionId,
            error: errorMessage,
          });
        }
      }

      await this.releaseInflightLanguages(assignmentId, skippedLanguages);
      await this.syncLimiterForTranslationModel();
    } catch (error) {
      await this.markPreFanoutTranslationFailed(
        parentJobId,
        "question",
        questionId,
        assignmentId,
        supportedLanguages,
        markTerminalFailure,
      );
      throw error;
    }
    let completedLangCounter = skippedLanguages.length;
    // Collect per-language rows from the parallel fan-out into this
    // closure array, then issue ONE bulk INSERT per question after the
    // parallel section completes. Replaces the per-language single-row
    // INSERT loop (was 23 round-trips per question; now 1).
    const collectedRows: TranslationInsertRow[] = [];
    // Bottleneck's `expiration` rejects its own promise but does NOT
    // cancel the underlying operation. A slow LLM callback whose
    // Bottleneck promise rejected is orphaned and keeps running — its
    // tail-end mid-loop HSET would land after the terminal HSET and
    // leave the entry stuck at in_progress=N. Flip this after the
    // parallel section returns and gate every observable side effect
    // (mid-loop HSET, collectedRows push) on it.
    let parallelDone = false;
    const results = await this.processBatchesInParallel(
      targetLanguages,
      async (lang: string) => {
        try {
          if (progressTracker && !parallelDone) {
            await this.updateJobProgress(
              progressTracker,
              getLanguageNameFromCode(lang),
              undefined,
              lang === questionLang
                ? "Storing original content"
                : "Checking for existing translation",
            );
          }

          const row = await this.generateTranslation(
            assignmentId,
            questionId,
            null,
            normalizedText,
            normalizedChoices,
            questionLang,
            lang,
          );
          if (row !== null && !parallelDone) {
            collectedRows.push(row);
          }

          if (progressTracker && !parallelDone) {
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

          // Throttled mid-loop HSET. Bounds the Redis write rate from a
          // worst-case 23 writes/job-per-language down to ~7 by firing every
          // 5th language, on the final iteration, AND on the last 2 langs.
          // The last-2 cases stop the UI from sitting at 20/23 for the tail
          // latency (otherwise no update fires between 20 and 23).
          const c = ++completedLangCounter;
          if (
            parentJobId &&
            !parallelDone &&
            (c % 5 === 0 || c >= getSupportedLanguageCount() - 2)
          ) {
            try {
              await this.translationStateRedis?.hset(
                buildPublishHashKey(parentJobId),
                `question:${questionId}`,
                JSON.stringify({
                  kind: "question",
                  id: questionId,
                  status: "in_progress",
                  languagesCompleted: c,
                  languagesTotal: getSupportedLanguageCount(),
                } satisfies PerJobTranslationEntry),
              );
            } catch {
              // Mid-loop HSET is throttled and recoverable — the terminal
              // HSET below covers the case where mid-loop writes were lost.
            }
          }

          return row !== null;
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Failed to translate question ${questionId} to ${lang}: ${errorMessage}`,
          );
          return false;
        } finally {
          // Per-language terminal exit (success OR failure) drains the
          // language from the per-assignment in-flight refcount hash so the
          // learner-side resolver can flip the pending marker.
          await this.releaseInflightLanguage(assignmentId, lang);
        }
      },
      this.MAX_BATCH_SIZE,
      this.CONCURRENCY_LIMIT,
    );
    parallelDone = true;

    // Single bulk INSERT for all collected rows. The rowcount returned by
    // $executeRaw is the number actually written; the difference vs.
    // collectedRows.length is the number that hit ON CONFLICT DO NOTHING
    // because the row already existed (re-publish of unchanged content).
    const insertedCount =
      await this.insertTranslationsOnConflictDoNothing(collectedRows);
    const outcome: TranslationOutcome = {
      inserted: insertedCount,
      skipped: skippedLanguages.length + collectedRows.length - insertedCount,
      failed: results.failure,
    };

    if (parentJobId) {
      try {
        await this.translationStateRedis?.hset(
          buildPublishHashKey(parentJobId),
          `question:${questionId}`,
          JSON.stringify({
            kind: "question",
            id: questionId,
            status: this.terminalEntryStatus(
              outcome.failed,
              markTerminalFailure,
            ),
            languagesCompleted: outcome.inserted + outcome.skipped,
            languagesTotal: getSupportedLanguageCount(),
          } satisfies PerJobTranslationEntry),
        );
      } catch (hsetError) {
        const errorMessage =
          hsetError instanceof Error ? hsetError.message : String(hsetError);
        this.logger.warn("publish.translation.job.hset.terminal.failed", {
          assignmentId,
          kind: "question",
          id: questionId,
          error: errorMessage,
        });
      }
    }

    if (hasValidJobId) {
      this.cleanupCancelledJob(jobId);
    }

    this.logger.log(
      `Question #${questionId} translation results: ${outcome.inserted} inserted, ${outcome.skipped} skipped, ${outcome.failed} failed`,
    );

    return outcome;
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
    jobId?: string,
    forceRetranslation = false,
    markTerminalFailure = true,
  ): Promise<TranslationOutcome> {
    const hasValidJobId = typeof jobId === "string" && jobId.length > 0;

    if (!this._languageTranslation) {
      if (hasValidJobId) {
        await this.jobStatusService.updateJobStatus(jobId, {
          status: "Completed",
          progress: `Translation skipped for variant #${variantId} (disabled in development mode)`,
          percentage: 100,
        });
      }
      return { inserted: 0, skipped: 0, failed: 0 };
    }

    if (hasValidJobId) {
      this.jobStartTimes.set(jobId, Date.now());
    }
    const normalizedText = variant.variantContent.trim();
    const normalizedChoices = variant.choices ?? null;
    const supportedLanguages = getAllLanguageCodes() ?? ["en"];
    const parentJobId = hasValidJobId ? jobId : undefined;
    let variantLang = "en";
    let progressTracker: ProgressTracker | undefined;
    let targetLanguages = supportedLanguages;
    let skippedLanguages: string[] = [];

    try {
      if (!forceRetranslation) {
        const existingTranslations = await this.prisma.translation.findMany({
          where: {
            questionId: questionId,
            variantId: variantId,
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
          await this.markPublishTranslationCompleted(
            parentJobId,
            "variant",
            variantId,
            supportedLanguages.length,
          );
          await this.releaseInflightLanguages(assignmentId, supportedLanguages);
          if (hasValidJobId) {
            this.cleanupCancelledJob(jobId);
          }
          return { inserted: 0, skipped: supportedLanguages.length, failed: 0 };
        }

        skippedLanguages = supportedLanguages.filter((lang) =>
          existingLanguages.has(lang),
        );
        targetLanguages = missingLanguages;
      }

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

      progressTracker = hasValidJobId
        ? this.initializeProgressTracker(
            jobId,
            Math.ceil(supportedLanguages.length / this.MAX_BATCH_SIZE),
            20,
            95,
            `Translating Variant #${variantId}`,
            supportedLanguages.length,
          )
        : undefined;

      if (forceRetranslation) {
        await this.prisma.translation.deleteMany({
          where: {
            questionId: questionId,
            variantId: variantId,
          },
        });
      }

      // Write the per-job entry on the publish-job's status hash so the
      // publish poll loop sees this work in flight. The parentJobId IS the
      // existing jobId parameter — no parallel parameter is introduced.
      // A 1-hour TTL fallback is set on first write so the hash auto-clears
      // even if the publish poll loop dies before its terminal DEL.
      if (parentJobId) {
        try {
          await this.translationStateRedis?.hset(
            buildPublishHashKey(parentJobId),
            `variant:${variantId}`,
            JSON.stringify({
              kind: "variant",
              id: variantId,
              status: "in_progress",
              languagesCompleted: skippedLanguages.length,
              languagesTotal: getSupportedLanguageCount(),
            } satisfies PerJobTranslationEntry),
          );
          await this.translationStateRedis?.expire(
            buildPublishHashKey(parentJobId),
            PUBLISH_HASH_TTL_SECONDS,
          );
        } catch (hsetError) {
          const errorMessage =
            hsetError instanceof Error ? hsetError.message : String(hsetError);
          this.logger.warn("publish.translation.job.hset.failed", {
            assignmentId,
            kind: "variant",
            id: variantId,
            error: errorMessage,
          });
        }
      }

      await this.releaseInflightLanguages(assignmentId, skippedLanguages);
      await this.syncLimiterForTranslationModel();
    } catch (error) {
      await this.markPreFanoutTranslationFailed(
        parentJobId,
        "variant",
        variantId,
        assignmentId,
        supportedLanguages,
        markTerminalFailure,
      );
      throw error;
    }

    let completedLangCounter = skippedLanguages.length;
    // Collect per-language rows from the parallel fan-out; ONE bulk
    // INSERT after the parallel section completes (was 23 round-trips).
    const collectedRows: TranslationInsertRow[] = [];
    // Bottleneck `expiration` rejects its own promise but does NOT
    // cancel the underlying operation. See translateQuestion for the
    // full story; same race + same guard.
    let parallelDone = false;
    const results = await this.processBatchesInParallel(
      targetLanguages,
      async (lang: string) => {
        try {
          if (progressTracker && !parallelDone) {
            await this.updateJobProgress(
              progressTracker,
              getLanguageNameFromCode(lang),
              undefined,
              lang === variantLang
                ? "Storing original content"
                : "Checking for existing translation",
            );
          }

          const row = await this.generateTranslation(
            assignmentId,
            questionId,
            variantId,
            normalizedText,
            normalizedChoices,
            variantLang,
            lang,
          );
          if (row !== null && !parallelDone) {
            collectedRows.push(row);
          }

          if (progressTracker && !parallelDone) {
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

          // Throttled mid-loop HSET. Bounds the Redis write rate from a
          // worst-case 23 writes/job-per-language down to ~7 by firing every
          // 5th language, on the final iteration, AND on the last 2 langs.
          // The last-2 cases stop the UI from sitting at 20/23 for the tail
          // latency (otherwise no update fires between 20 and 23).
          const c = ++completedLangCounter;
          if (
            parentJobId &&
            !parallelDone &&
            (c % 5 === 0 || c >= getSupportedLanguageCount() - 2)
          ) {
            try {
              await this.translationStateRedis?.hset(
                buildPublishHashKey(parentJobId),
                `variant:${variantId}`,
                JSON.stringify({
                  kind: "variant",
                  id: variantId,
                  status: "in_progress",
                  languagesCompleted: c,
                  languagesTotal: getSupportedLanguageCount(),
                } satisfies PerJobTranslationEntry),
              );
            } catch {
              // Mid-loop HSET is throttled and recoverable — the terminal
              // HSET below covers the case where mid-loop writes were lost.
            }
          }

          return row !== null;
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Failed to translate variant ${variantId} to ${lang}: ${errorMessage}`,
          );
          return false;
        } finally {
          // Per-language terminal exit (success OR failure) drains the
          // language from the per-assignment in-flight refcount hash so the
          // learner-side resolver can flip the pending marker.
          await this.releaseInflightLanguage(assignmentId, lang);
        }
      },
      this.MAX_BATCH_SIZE,
      this.CONCURRENCY_LIMIT,
    );
    parallelDone = true;

    const insertedCount =
      await this.insertTranslationsOnConflictDoNothing(collectedRows);
    const outcome: TranslationOutcome = {
      inserted: insertedCount,
      skipped: skippedLanguages.length + collectedRows.length - insertedCount,
      failed: results.failure,
    };

    if (parentJobId) {
      try {
        await this.translationStateRedis?.hset(
          buildPublishHashKey(parentJobId),
          `variant:${variantId}`,
          JSON.stringify({
            kind: "variant",
            id: variantId,
            status: this.terminalEntryStatus(
              outcome.failed,
              markTerminalFailure,
            ),
            languagesCompleted: outcome.inserted + outcome.skipped,
            languagesTotal: getSupportedLanguageCount(),
          } satisfies PerJobTranslationEntry),
        );
      } catch (hsetError) {
        const errorMessage =
          hsetError instanceof Error ? hsetError.message : String(hsetError);
        this.logger.warn("publish.translation.job.hset.terminal.failed", {
          assignmentId,
          kind: "variant",
          id: variantId,
          error: errorMessage,
        });
      }
    }

    if (hasValidJobId) {
      this.cleanupCancelledJob(jobId);
    }

    this.logger.log(
      `Variant #${variantId} translation results: ${outcome.inserted} inserted, ${outcome.skipped} skipped, ${outcome.failed} failed`,
    );

    return outcome;
  }

  /**
   * Translate a specific question/variant to a list of target languages.
   *
   * All LLM calls are fanned out in parallel (bounded by the active rate-limit
   * limiter), and the resulting rows are written in a **single** `createMany`
   * call instead of one `create` per language.
   */
  async translateContentToLanguages(
    assignmentId: number,
    questionId: number,
    variantId: number | null,
    originalText: string,
    originalChoices: Choice[] | string | null | any,
    sourceLanguage: string,
    targetLanguages: string[],
  ): Promise<{
    success: number;
    failure: number;
    successfulLanguages: string[];
    failedLanguages: string[];
  }> {
    if (!targetLanguages || targetLanguages.length === 0) {
      return {
        success: 0,
        failure: 0,
        successfulLanguages: [],
        failedLanguages: [],
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const parsedChoices = this.parseChoices(originalChoices);

    const settled = await Promise.allSettled(
      targetLanguages.map((lang) =>
        this.scheduleOnActiveLimiter(
          `translateContentToLanguages-${String(questionId)}-${lang}`,
          () =>
            this.generateTranslationForLanguage(
              assignmentId,
              questionId,
              originalText,
              parsedChoices,
              sourceLanguage,
              lang,
            ),
        ),
      ),
    );

    interface PendingTranslationRow {
      languageCode: string;
      translatedText: string;
      translatedChoices: Choice[] | null;
    }

    const rows: PendingTranslationRow[] = [];
    let success = 0;
    let failure = 0;
    const successfulLanguages: string[] = [];
    const failedLanguages: string[] = [];

    for (const [index, result] of settled.entries()) {
      const lang = targetLanguages[index];

      if (result.status === "fulfilled") {
        rows.push({
          languageCode: lang,
          translatedText: result.value.translatedText,
          translatedChoices: result.value.translatedChoices,
        });
        success++;
        successfulLanguages.push(lang);
      } else {
        const reason =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);
        this.logger.error(
          `Failed to translate question ${questionId}${
            variantId ? ` variant ${variantId}` : ""
          } to ${lang}: ${reason}`,
        );
        failure++;
        failedLanguages.push(lang);
      }
    }

    if (rows.length > 0) {
      // Delete-then-insert preserves the previous "refresh translation"
      // semantic for this batched path. The per-row raw INSERT with
      // ON CONFLICT DO NOTHING also keeps two concurrent fan-outs from
      // duplicating rows even if the deleteMany window slips, because
      // the partial unique indexes on Translation force first-writer-
      // wins. createMany is avoided here because Prisma can't pin the
      // ON CONFLICT clause to a partial unique index.
      await this.prisma.$transaction(async (tx) => {
        await tx.translation.deleteMany({
          where: {
            questionId,
            variantId,
            languageCode: { in: successfulLanguages },
          },
        });

        for (const row of rows) {
          const translatedChoicesJson =
            row.translatedChoices == null
              ? null
              : JSON.stringify(row.translatedChoices);
          const untranslatedChoicesJson =
            parsedChoices == null ? null : JSON.stringify(parsedChoices);

          await tx.$executeRaw`
            INSERT INTO "Translation"
              ("questionId", "variantId", "languageCode",
               "translatedText", "untranslatedText",
               "translatedChoices", "untranslatedChoices",
               "createdAt")
            VALUES
              (${questionId}, ${variantId}, ${row.languageCode},
               ${row.translatedText}, ${originalText},
               ${translatedChoicesJson}::jsonb,
               ${untranslatedChoicesJson}::jsonb,
               NOW())
            ON CONFLICT DO NOTHING
          `;
        }
      });
    }

    return { success, failure, successfulLanguages, failedLanguages };
  }

  /**
   * Generate the translated text and choices for a single target language.
   * Does NOT write to the database — caller is responsible for the batch write.
   */
  private async generateTranslationForLanguage(
    assignmentId: number,
    questionId: number,
    originalText: string,
    parsedChoices: Choice[] | null,
    sourceLanguage: string,
    targetLanguage: string,
  ): Promise<{ translatedText: string; translatedChoices: Choice[] | null }> {
    if (sourceLanguage.toLowerCase() === targetLanguage.toLowerCase()) {
      return { translatedText: originalText, translatedChoices: parsedChoices };
    }

    const [translatedText, translatedChoices] = await Promise.all([
      this.executeWithOptimizedRetry(
        `translateQuestionText-${questionId}-${targetLanguage}`,
        () =>
          this.llmFacadeService.generateQuestionTranslation(
            assignmentId,
            originalText,
            targetLanguage,
          ),
      ).catch((error: unknown) => {
        this.logger.error(
          `Failed to translate text for question ${questionId} to ${targetLanguage}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        throw error;
      }),

      parsedChoices && parsedChoices.length > 0
        ? this.executeWithOptimizedRetry(
            `translateChoices-${questionId}-${targetLanguage}`,
            () =>
              this.llmFacadeService.generateChoicesTranslation(
                parsedChoices,
                assignmentId,
                targetLanguage,
              ),
          ).catch((error: unknown) => {
            this.logger.error(
              `Failed to translate choices for question ${questionId} to ${targetLanguage}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            return parsedChoices;
          })
        : Promise.resolve(parsedChoices),
    ]);

    return {
      translatedText: translatedText,
      translatedChoices: translatedChoices,
    };
  }

  /**
   * Parse raw choices from the database (JSON string or array) into a typed
   * array. Returns null for empty / unparseable values.
   */
  private parseChoices(
    originalChoices: Choice[] | string | null | undefined,
  ): Choice[] | null {
    if (!originalChoices) return null;

    if (typeof originalChoices === "string") {
      try {
        return JSON.parse(originalChoices) as Choice[];
      } catch (error) {
        this.logger.error(
          `Failed to parse choices JSON: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return null;
      }
    }

    if (Array.isArray(originalChoices)) {
      return originalChoices;
    }

    this.logger.warn(
      `Unexpected type for originalChoices: ${typeof originalChoices}`,
    );
    return null;
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
                `Failed to translate ${field} for assignment ${assignment.id} to ${lang}: ${errorMessage}`,
              );
              throw error;
            }),
        );
      } else {
        translatedData[field] = "";
      }
    }

    try {
      await Promise.all(translationPromises);

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
  private async generateTranslation(
    assignmentId: number,
    questionId: number,
    variantId: number | null,
    originalText: string,
    originalChoices: Choice[] | null | string | any,
    sourceLanguage: string,
    targetLanguage: string,
  ): Promise<TranslationInsertRow | null> {
    // Returns a row payload on success; returns null when the LLM call
    // failed for this language. The caller distinguishes "row landed or
    // was a no-op" (counted in inserted/skipped) from "no row produced"
    // (counted in failed) without needing the LLM error to throw.
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
        this.logger.warn(
          `Unexpected type for originalChoices: ${typeof originalChoices}`,
        );
        parsedChoices = null;
      }
    }
    if (sourceLanguage.toLowerCase() === targetLanguage.toLowerCase()) {
      return {
        questionId,
        variantId,
        languageCode: targetLanguage,
        translatedText: originalText,
        untranslatedText: originalText,
        translatedChoices: parsedChoices,
        untranslatedChoices: parsedChoices,
      };
    }

    const translationPromises: Array<Promise<any>> = [];
    let translatedText: string = originalText;
    let translatedChoices: Choice[] | null = parsedChoices;
    let textTranslationFailed = false;

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
            `Failed to translate question text for question ${questionId} to ${targetLanguage}: ${errorMessage}`,
          );
          textTranslationFailed = true;
        }),
    );

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
            this.logger.error(
              `Failed to translate choices for question ${questionId} to ${targetLanguage}: ${errorMessage}`,
            );
          }),
      );
    }

    try {
      await Promise.all(translationPromises);

      if (textTranslationFailed) {
        this.logger.warn(
          `Skipping translation row for question ${questionId} in ${targetLanguage}: text translation failed`,
        );
        return null;
      }

      return {
        questionId,
        variantId,
        languageCode: targetLanguage,
        translatedText,
        untranslatedText: originalText,
        translatedChoices,
        untranslatedChoices: parsedChoices,
      };
    } catch (translationError) {
      this.logger.warn(
        `Skipping translation record creation for ${targetLanguage} due to translation failure for question ${questionId}${
          variantId ? ` variant ${variantId}` : ""
        }`,
      );
      throw translationError;
    }
  }

  /**
   * Insert a Translation row using raw $executeRaw with ON CONFLICT DO
   * NOTHING. This targets the partial unique indexes on Translation
   * (Translation_question_lang_unique_no_variant when variantId IS NULL,
   * Translation_question_lang_variant_unique when variantId IS NOT NULL)
   * so concurrent writers for the same (questionId, variantId,
   * languageCode) tuple silently no-op instead of failing.
   *
   * The column list mirrors the prior prisma.translation.create call
   * sites exactly — no assignmentId (Translation has none; scope is
   * implied via Question.assignmentId cascade FK). JSONB casts are
   * required for translatedChoices / untranslatedChoices because raw
   * SQL parameters default to text.
   */
  private async insertTranslationsOnConflictDoNothing(
    rows: TranslationInsertRow[],
  ): Promise<number> {
    // Empty-array guard: Prisma.join on an empty list produces invalid
    // SQL ("VALUES " with nothing after it), so short-circuit before
    // touching the database. Returning 0 reflects the truth — no rows
    // landed because no rows were offered.
    if (rows.length === 0) {
      return 0;
    }

    const values = rows.map(
      (r) => Prisma.sql`(
        ${r.questionId}, ${r.variantId}, ${r.languageCode},
        ${r.translatedText}, ${r.untranslatedText},
        ${
          r.translatedChoices == null
            ? null
            : JSON.stringify(r.translatedChoices)
        }::jsonb,
        ${
          r.untranslatedChoices == null
            ? null
            : JSON.stringify(r.untranslatedChoices)
        }::jsonb,
        NOW()
      )`,
    );

    return this.prisma.$executeRaw`
      INSERT INTO "Translation"
        ("questionId", "variantId", "languageCode",
         "translatedText", "untranslatedText",
         "translatedChoices", "untranslatedChoices",
         "createdAt")
      VALUES ${Prisma.join(values, ", ")}
      ON CONFLICT DO NOTHING
    `;
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
