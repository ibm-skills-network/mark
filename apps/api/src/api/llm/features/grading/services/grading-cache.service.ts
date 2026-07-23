import { Injectable, Inject, Optional, OnModuleDestroy } from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import IORedis from "ioredis";
import {
  ICachedGradingResult,
  IGradingCacheService,
} from "../interfaces/grading-cache.interface";
import { PrismaService } from "src/database/prisma.service";
import { Prisma } from "@prisma/client";
import { createRedisConnection } from "src/job-queue/redis.connection";

const REDIS_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Service for caching grading results.
 *
 * Uses a two-layer cache strategy:
 *   L1 — Redis (fast, in-memory, 7-day TTL)
 *   L2 — PostgreSQL (persistent, source of truth)
 *
 * On cache hit Redis serves the result without touching PostgreSQL.
 * On cache miss the result is fetched from PostgreSQL and backfilled into Redis.
 * If Redis is unavailable, all operations fall through gracefully to PostgreSQL.
 */
@Injectable()
export class GradingCacheService
  implements IGradingCacheService, OnModuleDestroy
{
  private readonly logger: Logger;
  private redis?: IORedis;

  constructor(
    @Optional() private readonly prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: GradingCacheService.name });
    this.redis = this.createRedisClient();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      await this.redis.quit().catch(() => {
        // Ignore quit errors during teardown
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Redis helpers
  // ─────────────────────────────────────────────────────────────────────────────

  private createRedisClient(): IORedis | undefined {
    try {
      const client = createRedisConnection();
      client.on("error", (error) => {
        this.logger.warn(
          `GradingCache Redis error (falling back to PostgreSQL): ${error.message}`,
        );
      });
      return client;
    } catch {
      this.logger.warn(
        "GradingCache could not connect to Redis — running in PostgreSQL-only mode",
      );
      return undefined;
    }
  }

  private redisKey(cacheKey: string): string {
    return `mark:grading-cache:${cacheKey}`;
  }

  private async redisGet(
    cacheKey: string,
  ): Promise<ICachedGradingResult | null> {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.get(this.redisKey(cacheKey));
      if (!raw) return null;
      return JSON.parse(raw) as ICachedGradingResult;
    } catch {
      return null;
    }
  }

  private async redisSet(result: ICachedGradingResult): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(
        this.redisKey(result.cacheKey),
        JSON.stringify(result),
        "EX",
        REDIS_TTL_SECONDS,
      );
    } catch {
      // Non-fatal — PostgreSQL is the source of truth
    }
  }

  private async redisDel(cacheKey: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(this.redisKey(cacheKey));
    } catch {
      // Non-fatal
    }
  }

  /**
   * Delete all Redis keys for a question using SCAN to avoid blocking.
   * Key pattern: mark:grading-cache:<questionId>:*
   * Note: the standard cacheKey format does not embed questionId, so we
   * fall back to a full-prefix scan limited to 1000 keys per call.
   */
  private async redisInvalidateQuestion(questionId: number): Promise<void> {
    if (!this.redis) return;
    try {
      const pattern = `mark:grading-cache:*`;
      let cursor = "0";
      let deletedCount = 0;
      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          "MATCH",
          pattern,
          "COUNT",
          100,
        );
        cursor = nextCursor;

        // Filter keys that belong to this questionId by checking the stored value
        for (const key of keys) {
          try {
            const raw = await this.redis.get(key);
            if (raw) {
              const parsed = JSON.parse(raw) as ICachedGradingResult;
              if (parsed.questionId === questionId) {
                await this.redis.del(key);
                deletedCount++;
              }
            }
          } catch {
            // Skip keys that fail to parse
          }
        }
      } while (cursor !== "0");

      if (deletedCount > 0) {
        this.logger.info(
          `Invalidated ${deletedCount} Redis cache entries for question ${questionId}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to invalidate Redis cache for question ${questionId}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // IGradingCacheService implementation
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get a cached grading result if it exists.
   * Checks Redis first (L1), falls back to PostgreSQL (L2) on miss.
   */
  async getCachedGrading(
    cacheKey: string,
  ): Promise<ICachedGradingResult | null> {
    // L1: Redis
    const redisResult = await this.redisGet(cacheKey);
    if (redisResult) {
      this.logger.info(
        `L1 cache hit (Redis) for key: ${cacheKey} (hit count: ${redisResult.hitCount + 1})`,
      );
      // Fire-and-forget: increment hit count in PostgreSQL
      if (this.prisma) {
        this.prisma.gradingCache
          .update({
            where: { cacheKey },
            data: { hitCount: { increment: 1 } },
          })
          .catch((error) => {
            this.logger.warn(
              `Failed to update hit count: ${
                error instanceof Error ? error.message : "Unknown error"
              }`,
            );
          });
      }
      return { ...redisResult, hitCount: redisResult.hitCount + 1 };
    }

    // L2: PostgreSQL
    if (!this.prisma) {
      this.logger.warn("Prisma service not available, cache disabled");
      return null;
    }

    try {
      const databaseCached = await this.prisma.gradingCache.findUnique({
        where: { cacheKey },
      });

      if (databaseCached) {
        const criteria = Array.isArray(databaseCached.criteria)
          ? (databaseCached.criteria as ICachedGradingResult["criteria"])
          : [];
        const metadata = (databaseCached.metadata ?? undefined) as
          | ICachedGradingResult["metadata"]
          | undefined;

        const result: ICachedGradingResult = {
          cacheKey: databaseCached.cacheKey,
          questionId: databaseCached.questionId,
          rubricHash: databaseCached.rubricHash,
          answerHash: databaseCached.answerHash,
          totalScore: databaseCached.totalScore,
          maxScore: databaseCached.maxScore,
          criteria,
          overallFeedback: databaseCached.overallFeedback,
          cachedAt: databaseCached.cachedAt,
          hitCount: databaseCached.hitCount + 1,
          metadata,
        };

        // Backfill Redis
        await this.redisSet(result);

        this.prisma.gradingCache
          .update({
            where: { cacheKey },
            data: { hitCount: result.hitCount },
          })
          .catch((error) => {
            this.logger.warn(
              `Failed to update hit count: ${
                error instanceof Error ? error.message : "Unknown error"
              }`,
            );
          });

        this.logger.info(
          `L2 cache hit (PostgreSQL) for key: ${cacheKey} (hit count: ${result.hitCount})`,
        );
        return result;
      }

      this.logger.debug(`Cache miss for key: ${cacheKey}`);
      return null;
    } catch (error) {
      this.logger.error(
        `Error retrieving from cache: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      return null;
    }
  }

  /**
   * Store a grading result in both Redis (L1) and PostgreSQL (L2).
   */
  async cacheGrading(result: ICachedGradingResult): Promise<void> {
    if (!this.prisma) {
      this.logger.warn("Prisma service not available, cache disabled");
      return;
    }

    try {
      await this.prisma.gradingCache.upsert({
        where: { cacheKey: result.cacheKey },
        create: {
          cacheKey: result.cacheKey,
          questionId: result.questionId,
          rubricHash: result.rubricHash,
          answerHash: result.answerHash,
          totalScore: result.totalScore,
          maxScore: result.maxScore,
          criteria: result.criteria as Prisma.InputJsonValue,
          overallFeedback: result.overallFeedback,
          cachedAt: result.cachedAt,
          hitCount: result.hitCount,
          metadata: result.metadata as Prisma.InputJsonValue,
        },
        update: {
          totalScore: result.totalScore,
          maxScore: result.maxScore,
          criteria: result.criteria as Prisma.InputJsonValue,
          overallFeedback: result.overallFeedback,
          hitCount: result.hitCount,
          metadata: result.metadata as Prisma.InputJsonValue,
        },
      });

      // Write to Redis after PostgreSQL succeeds
      await this.redisSet(result);

      this.logger.info(
        `Cached grading result for question ${result.questionId} (key: ${result.cacheKey})`,
      );
    } catch (error) {
      this.logger.error(
        `Error caching grading result: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      throw error;
    }
  }

  async cacheGradingIfAbsent(
    result: ICachedGradingResult,
  ): Promise<ICachedGradingResult> {
    if (!this.prisma) {
      this.logger.warn("Prisma service not available, cache disabled");
      return result;
    }

    try {
      await this.prisma.gradingCache.create({
        data: {
          cacheKey: result.cacheKey,
          questionId: result.questionId,
          rubricHash: result.rubricHash,
          answerHash: result.answerHash,
          totalScore: result.totalScore,
          maxScore: result.maxScore,
          criteria: result.criteria as Prisma.InputJsonValue,
          overallFeedback: result.overallFeedback,
          cachedAt: result.cachedAt,
          hitCount: result.hitCount,
          metadata: result.metadata as Prisma.InputJsonValue,
        },
      });
      await this.redisSet(result);
      return result;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const canonical = await this.getCachedGrading(result.cacheKey);
        if (canonical) return canonical;
      }
      throw error;
    }
  }

  /**
   * Check if a grading result is cached
   */
  async isCached(cacheKey: string): Promise<boolean> {
    // Fast Redis check first
    if (this.redis) {
      try {
        const exists = await this.redis.exists(this.redisKey(cacheKey));
        if (exists) return true;
      } catch {
        // Fall through to PostgreSQL
      }
    }

    if (!this.prisma) {
      return false;
    }

    try {
      const count = await this.prisma.gradingCache.count({
        where: { cacheKey },
      });
      return count > 0;
    } catch (error) {
      this.logger.error(
        `Error checking cache: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      return false;
    }
  }

  /**
   * Get cache statistics for a question
   */
  async getCacheStats(questionId: number): Promise<{
    totalCached: number;
    totalHits: number;
    cacheHitRate: number;
  }> {
    if (!this.prisma) {
      return { totalCached: 0, totalHits: 0, cacheHitRate: 0 };
    }

    try {
      const results = await this.prisma.gradingCache.findMany({
        where: { questionId },
        select: { hitCount: true },
      });

      const totalCached = results.length;
      const totalHits = results.reduce((sum, r) => sum + r.hitCount, 0);
      const cacheHitRate =
        totalCached > 0 ? (totalHits / (totalCached + totalHits)) * 100 : 0;

      return {
        totalCached,
        totalHits,
        cacheHitRate,
      };
    } catch (error) {
      this.logger.error(
        `Error getting cache stats: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      return { totalCached: 0, totalHits: 0, cacheHitRate: 0 };
    }
  }

  /**
   * Invalidate cache for a specific question (e.g., when rubric changes).
   * Removes entries from both Redis (L1) and PostgreSQL (L2).
   */
  async invalidateQuestionCache(questionId: number): Promise<void> {
    // Invalidate Redis first (non-blocking)
    void this.redisInvalidateQuestion(questionId);

    if (!this.prisma) {
      this.logger.warn("Prisma service not available, cache disabled");
      return;
    }

    try {
      const result = await this.prisma.gradingCache.deleteMany({
        where: { questionId },
      });

      this.logger.info(
        `Invalidated ${result.count} PostgreSQL cache entries for question ${questionId}`,
      );
    } catch (error) {
      this.logger.error(
        `Error invalidating cache: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  /**
   * Clear all caches (for testing)
   */
  async clearAll(): Promise<void> {
    // Clear Redis keys with the grading-cache prefix
    if (this.redis) {
      try {
        let cursor = "0";
        do {
          const [nextCursor, keys] = await this.redis.scan(
            cursor,
            "MATCH",
            "mark:grading-cache:*",
            "COUNT",
            100,
          );
          cursor = nextCursor;
          if (keys.length > 0) {
            await this.redis.del(...keys);
          }
        } while (cursor !== "0");
        this.logger.info("Cleared all Redis grading cache entries");
      } catch (error) {
        this.logger.warn(
          `Failed to clear Redis grading cache: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
      }
    }

    if (!this.prisma) {
      this.logger.warn("Prisma service not available, cache disabled");
      return;
    }

    try {
      await this.prisma.gradingCache.deleteMany({});
      this.logger.info("Cleared all PostgreSQL grading cache entries");
    } catch (error) {
      this.logger.error(
        `Error clearing cache: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }
}
