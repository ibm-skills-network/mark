import { Injectable, Inject, Optional } from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import {
  ICachedGradingResult,
  IGradingCacheService,
} from "../interfaces/grading-cache.interface";
import { PrismaService } from "src/database/prisma.service";
import { Prisma } from "@prisma/client";

/**
 * Service for caching grading results using PostgreSQL
 *
 * Benefits:
 * - Same input → same output (determinism)
 * - Instant re-grading for identical submissions
 * - Regression testing capability
 * - Cost savings (reduced LLM calls)
 * - Works in distributed/multi-instance environments
 * - Leverages PostgreSQL indexing for fast lookups
 */
@Injectable()
export class GradingCacheService implements IGradingCacheService {
  private readonly logger: Logger;

  constructor(
    @Optional() private readonly prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: GradingCacheService.name });
  }

  /**
   * Get a cached grading result if it exists
   */
  async getCachedGrading(
    cacheKey: string,
  ): Promise<ICachedGradingResult | null> {
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
          `Cache hit for key: ${cacheKey} (hit count: ${result.hitCount})`,
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
   * Store a grading result in the cache
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

  /**
   * Check if a grading result is cached
   */
  async isCached(cacheKey: string): Promise<boolean> {
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
   * Invalidate cache for a specific question (e.g., when rubric changes)
   */
  async invalidateQuestionCache(questionId: number): Promise<void> {
    if (!this.prisma) {
      this.logger.warn("Prisma service not available, cache disabled");
      return;
    }

    try {
      const result = await this.prisma.gradingCache.deleteMany({
        where: { questionId },
      });

      this.logger.info(
        `Invalidated ${result.count} cache entries for question ${questionId}`,
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
    if (!this.prisma) {
      this.logger.warn("Prisma service not available, cache disabled");
      return;
    }

    try {
      await this.prisma.gradingCache.deleteMany({});
      this.logger.info("Cleared all cache entries");
    } catch (error) {
      this.logger.error(
        `Error clearing cache: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }
}
