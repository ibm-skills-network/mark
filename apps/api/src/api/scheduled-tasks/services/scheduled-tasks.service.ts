/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/**
 * ScheduledTasksService - Handles recurring background tasks and data maintenance
 *
 * This service manages scheduled tasks including:
 * - Assignment author migration and synchronization
 * - Old draft cleanup
 * - LLM pricing updates
 * - Insights precomputation
 *
 * @module scheduled-tasks
 */

import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../../database/prisma.service";
import { AdminService } from "../../admin/admin.service";
import { LLMPricingService } from "../../llm/core/services/llm-pricing.service";
import { LLM_PRICING_SERVICE } from "../../llm/llm.constants";

@Injectable()
export class ScheduledTasksService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ScheduledTasksService.name);

  constructor(
    private prismaService: PrismaService,
    @Inject(LLM_PRICING_SERVICE) private llmPricingService: LLMPricingService,
    private adminService: AdminService,
  ) {}

  /**
   * Runs initial tasks when the application starts
   *
   * @returns {Promise<void>}
   */
  async onApplicationBootstrap(): Promise<void> {
    this.logger.log("Application started - running initial tasks");
    await Promise.all([this.migrateExistingAuthors(), this.updateLLMPricing()]);
  }

  /**
   * Migrates existing authors from various tables to AssignmentAuthor table
   * Runs monthly and on application startup
   * Uses upsert to handle duplicates gracefully
   *
   * @returns {Promise<void>}
   */
  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async migrateExistingAuthors(): Promise<void> {
    this.logger.log(
      "Starting scheduled task: Migrate existing authors to AssignmentAuthor table",
    );

    try {
      const reportAuthors = await this.prismaService.report.findMany({
        where: {
          author: true,
          assignmentId: {
            not: null,
          },
        },
        select: {
          reporterId: true,
          assignmentId: true,
        },
        distinct: ["reporterId", "assignmentId"],
      });

      this.logger.log(
        `Found ${reportAuthors.length} potential authors from Report table`,
      );

      const aiUsageAuthors = await this.prismaService.aIUsage.findMany({
        where: {
          userId: {
            not: null,
          },
          usageType: {
            in: ["QUESTION_GENERATION", "ASSIGNMENT_GENERATION"],
          },
        },
        select: {
          userId: true,
          assignmentId: true,
        },
        distinct: ["userId", "assignmentId"],
      });

      this.logger.log(
        `Found ${aiUsageAuthors.length} potential authors from AIUsage table`,
      );

      const jobAuthors = await this.prismaService.job.findMany({
        select: {
          userId: true,
          assignmentId: true,
        },
        distinct: ["userId", "assignmentId"],
      });

      this.logger.log(
        `Found ${jobAuthors.length} potential authors from Job table`,
      );

      const publishJobAuthors = await this.prismaService.publishJob.findMany({
        where: {
          userId: {
            not: "SYSTEM_SCHEDULED_TASK",
          },
        },
        select: {
          userId: true,
          assignmentId: true,
        },
        distinct: ["userId", "assignmentId"],
      });

      const allPotentialAuthors = [
        ...reportAuthors
          .filter((r) => r.assignmentId !== null)
          .map((r) => ({
            userId: r.reporterId,
            assignmentId: r.assignmentId,
          })),
        ...aiUsageAuthors
          .filter((a) => a.userId !== null)
          .map((a) => ({
            userId: a.userId,
            assignmentId: a.assignmentId,
          })),
        ...jobAuthors.map((index) => ({
          userId: index.userId,
          assignmentId: index.assignmentId,
        })),
        ...publishJobAuthors.map((p) => ({
          userId: p.userId,
          assignmentId: p.assignmentId,
        })),
      ];

      const uniqueAuthors = allPotentialAuthors.filter(
        (author, index, self) =>
          author.userId &&
          author.assignmentId &&
          index ===
            self.findIndex(
              (a) =>
                a.userId === author.userId &&
                a.assignmentId === author.assignmentId,
            ),
      );

      this.logger.log(
        `Processing ${uniqueAuthors.length} unique author-assignment pairs`,
      );

      const results = await this.batchUpsertAuthors(uniqueAuthors);

      this.logger.log(
        `Completed scheduled task: Created ${results.created} new authors, ` +
          `updated ${results.updated} existing, skipped ${results.skipped} invalid entries`,
      );
    } catch (error) {
      this.logger.error("Error in migrateExistingAuthors:", error);
    }
  }

  /**
   * Batch upserts authors using efficient database operations
   *
   * @private
   * @param {Array} authors - Array of author objects to upsert
   * @returns {Promise<{created: number, updated: number, skipped: number}>}
   */
  private async batchUpsertAuthors(
    authors: Array<{ userId: string; assignmentId: number }>,
  ): Promise<{ created: number; updated: number; skipped: number }> {
    let created = 0;
    let updated = 0;
    let skipped = 0;

    const batchSize = 100;
    for (let index = 0; index < authors.length; index += batchSize) {
      const batch = authors.slice(index, index + batchSize);

      await this.prismaService.$transaction(async (tx) => {
        for (const author of batch) {
          try {
            const assignmentExists = await tx.assignment.findUnique({
              where: { id: author.assignmentId },
              select: { id: true },
            });

            if (!assignmentExists) {
              skipped++;
              continue;
            }

            const result = await tx.assignmentAuthor.upsert({
              where: {
                assignmentId_userId: {
                  assignmentId: author.assignmentId,
                  userId: author.userId,
                },
              },
              update: {
                createdAt: new Date(),
              },
              create: {
                assignmentId: author.assignmentId,
                userId: author.userId,
                createdAt: new Date(),
              },
            });

            if (result.createdAt.getTime() === Date.now()) {
              created++;
            } else {
              updated++;
            }
          } catch (error: { code: string } | any) {
            if (error.code === "P2002") {
              this.logger.debug(
                `Unexpected duplicate for assignment ${author.assignmentId}, user ${author.userId}`,
              );
            } else if (error.code === "P2003") {
              this.logger.debug(
                `Invalid reference for assignment ${author.assignmentId} or user ${author.userId}`,
              );
            } else {
              this.logger.error(
                `Failed to upsert author for assignment ${author.assignmentId}:`,
                error,
              );
            }
            skipped++;
          }
        }
      });
    }

    return { created, updated, skipped };
  }

  /**
   * Alternative implementation using createMany with skipDuplicates
   * More efficient for initial bulk migrations
   *
   * @param {Array} authors - Authors to create
   * @returns {Promise<number>} Number of created records
   */
  private async bulkCreateAuthors(
    authors: Array<{ userId: string; assignmentId: number }>,
  ): Promise<number> {
    try {
      const result = await this.prismaService.assignmentAuthor.createMany({
        data: authors.map((author) => ({
          assignmentId: author.assignmentId,
          userId: author.userId,
          createdAt: new Date(),
        })),
        skipDuplicates: true,
      });

      return result.count;
    } catch (error) {
      this.logger.error("Error in bulkCreateAuthors:", error);
      return 0;
    }
  }

  /**
   * Cleans up old assignment drafts
   * Runs weekly or can be triggered manually
   *
   * @param {number} customDaysOld - Optional custom age in days
   * @returns {Promise<Object>} Cleanup results
   */
  @Cron(CronExpression.EVERY_WEEK)
  async cleanupOldDrafts(customDaysOld?: number): Promise<{
    deletedCount: number;
    daysOld: number;
    cutoffDate: string;
  }> {
    const daysOld = customDaysOld === undefined ? 60 : customDaysOld;
    const isDeleteAll = daysOld === 0;

    this.logger.log(
      `Starting ${customDaysOld === undefined ? "scheduled" : "manual"} task: ${
        isDeleteAll
          ? "Delete ALL drafts"
          : `Cleanup old drafts (${daysOld} days old)`
      }`,
    );

    try {
      let whereCondition = {};
      let logMessage = "";

      if (isDeleteAll) {
        whereCondition = {};
        logMessage = "Looking for ALL drafts to delete";
      } else {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysOld);
        whereCondition = {
          createdAt: {
            lt: cutoffDate,
          },
        };
        logMessage = `Looking for drafts older than ${cutoffDate.toISOString()} (${daysOld} days ago)`;
      }

      this.logger.log(logMessage);

      const oldDrafts = await this.prismaService.assignmentDraft.findMany({
        where: whereCondition,
        select: {
          id: true,
          draftName: true,
          userId: true,
          createdAt: true,
          assignment: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      this.logger.log(
        `Found ${oldDrafts.length} ${
          isDeleteAll ? "drafts" : `drafts older than ${daysOld} days`
        }`,
      );

      if (oldDrafts.length === 0) {
        return {
          deletedCount: 0,
          daysOld,
          cutoffDate: isDeleteAll
            ? "ALL"
            : new Date(
                Date.now() - daysOld * 24 * 60 * 60 * 1000,
              ).toISOString(),
        };
      }

      for (const draft of oldDrafts) {
        this.logger.log(
          `Deleting draft: ID=${draft.id}, Name="${draft.draftName}", ` +
            `User=${draft.userId}, Created=${draft.createdAt.toISOString()}`,
        );
      }

      const deletedDrafts = await this.prismaService.assignmentDraft.deleteMany(
        {
          where: whereCondition,
        },
      );

      this.logger.log(
        `Completed task: Deleted ${deletedDrafts.count} ${
          isDeleteAll ? "drafts (ALL)" : "old drafts"
        }`,
      );

      return {
        deletedCount: deletedDrafts.count,
        daysOld,
        cutoffDate: isDeleteAll
          ? "ALL"
          : new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString(),
      };
    } catch (error) {
      this.logger.error("Error in cleanupOldDrafts:", error);
      throw error;
    }
  }

  /**
   * Updates LLM pricing from external API
   * Runs every 6 hours
   *
   * @returns {Promise<void>}
   */
  @Cron("0 */6 * * *")
  async updateLLMPricing(): Promise<void> {
    this.logger.log("Starting scheduled task: Update LLM pricing");

    try {
      const currentPricing = await this.llmPricingService.fetchCurrentPricing();

      if (currentPricing.length === 0) {
        this.logger.warn("No pricing data fetched from OpenAI");
        return;
      }

      const updatedCount =
        await this.llmPricingService.updatePricingHistory(currentPricing);

      this.logger.log(
        `Completed scheduled task: Updated pricing for ${updatedCount} models`,
      );

      const stats = await this.llmPricingService.getPricingStatistics();
      this.logger.log(
        `Pricing statistics: ${JSON.stringify(
          stats.totalModels,
        )} models, ${JSON.stringify(
          stats.activePricingRecords,
        )} active pricing records`,
      );
    } catch (error) {
      this.logger.error("Error in updateLLMPricing:", error);
    }
  }

  /**
   * Manually triggers LLM pricing update
   *
   * @returns {Promise<void>}
   */
  async manualUpdateLLMPricing(): Promise<void> {
    this.logger.log("Manual update of LLM pricing requested");
    await this.updateLLMPricing();
  }

  /**
   * Manually triggers draft cleanup
   *
   * @param {number} daysOld - Age of drafts to delete
   * @returns {Promise<Object>} Cleanup results
   */
  async manualCleanupOldDrafts(daysOld?: number) {
    this.logger.log(
      `Manual cleanup of old drafts requested${
        daysOld === undefined ? "" : ` (${daysOld} days old)`
      }`,
    );
    return await this.cleanupOldDrafts(daysOld);
  }

  /**
   * Precomputes insights for popular assignments
   * Runs every 3 hours
   *
   * @returns {Promise<void>}
   */
  @Cron(CronExpression.EVERY_3_HOURS)
  async precomputeInsights(): Promise<void> {
    this.logger.log(
      "Starting scheduled task: Precompute insights for popular assignments",
    );

    try {
      await this.adminService.precomputePopularInsights();
      this.logger.log("Completed scheduled task: Insights precomputation");
    } catch (error) {
      this.logger.error("Error in precomputeInsights:", error);
    }
  }

  /**
   * Manually triggers insights precomputation
   *
   * @returns {Promise<void>}
   */
  async manualPrecomputeInsights(): Promise<void> {
    this.logger.log("Manual precomputation of insights requested");
    await this.precomputeInsights();
  }
}
