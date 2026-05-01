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

  private areSchedulersEnabled(): boolean {
    return process.env.ENABLE_JOB_SCHEDULERS === "true";
  }

  /**
   * Runs initial tasks when the application starts
   *
   * @returns {Promise<void>}
   */
  async onApplicationBootstrap(): Promise<void> {
    if (!this.areSchedulersEnabled()) {
      this.logger.log("Background schedulers are disabled for this process");
      return;
    }

    this.logger.log("Application started - running initial tasks");
    await Promise.all([this.migrateExistingAuthors(), this.updateLLMPricing()]);
  }

  // @Cron(CronExpression.EVERY_DAY_AT_2AM)
  // async republishTopAssignments() {
  //   this.logger.log(
  //     "Starting scheduled task: Republish top 10 used assignments",
  //   );

  //   try {
  //     // Find top 10 most attempted assignments
  //     const topAssignments = await this.prismaService.assignmentAttempt.groupBy(
  //       {
  //         by: ["assignmentId"],
  //         _count: {
  //           assignmentId: true,
  //         },
  //         orderBy: {
  //           _count: {
  //             assignmentId: "desc",
  //           },
  //         },
  //         take: 10,
  //       },
  //     );

  //     this.logger.log(
  //       `Found ${topAssignments.length} top assignments to republish`,
  //     );

  //     // Update each assignment to trigger republishing/translation
  //     for (const assignment of topAssignments) {
  //       await this.prismaService.assignment.update({
  //         where: { id: assignment.assignmentId },
  //         data: {
  //           updatedAt: new Date(),
  //           published: true, // Ensure it's published
  //         },
  //       });

  //       // Create a publish job to trigger translation
  //         data: {
  //           userId: "SYSTEM_SCHEDULED_TASK",
  //           assignmentId: assignment.assignmentId,
  //           status: "Pending",
  //           progress: "Scheduled republishing of top assignment",
  //           percentage: 0,
  //         },
  //       });

  //       this.logger.log(
  //         `Republished assignment ${assignment.assignmentId} with ${assignment._count.assignmentId} attempts`,
  //       );
  //     }

  //     this.logger.log(
  //       "Completed scheduled task: Republish top 10 used assignments",
  //     );
  //   } catch (error) {
  //     this.logger.error("Error in republishTopAssignments:", error);
  //   }
  // }

  /**
   * Migrates existing authors from various tables to AssignmentAuthor table
   * Runs monthly and on application startup
   * Uses upsert to handle duplicates gracefully
   *
   * @returns {Promise<void>}
   */
  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async migrateExistingAuthors(allowWhenDisabled = false): Promise<void> {
    if (!allowWhenDisabled && !this.areSchedulersEnabled()) {
      return;
    }

    this.logger.log(
      "Starting scheduled task: Migrate existing authors to AssignmentAuthor table",
    );

    const PAGE_SIZE = 500;
    let totalCreated = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;

    try {
      // Report authors — paginated to avoid loading the full table into memory
      let skip = 0;
      let hasMore = true;
      while (hasMore) {
        const page = await this.prismaService.report.findMany({
          where: { author: true, assignmentId: { not: null } },
          select: { reporterId: true, assignmentId: true },
          distinct: ["reporterId", "assignmentId"],
          take: PAGE_SIZE,
          skip,
        });
        if (page.length === 0) break;

        const authors = page
          .filter((r) => r.assignmentId !== null)
          .map((r) => ({ userId: r.reporterId, assignmentId: r.assignmentId }));

        const result = await this.batchUpsertAuthors(authors);
        totalCreated += result.created;
        totalUpdated += result.updated;
        totalSkipped += result.skipped;

        hasMore = page.length === PAGE_SIZE;
        if (hasMore) {
          skip += PAGE_SIZE;
        }
      }
      this.logger.log("Processed report authors");

      // AI usage authors — paginated
      skip = 0;
      hasMore = true;
      while (hasMore) {
        const page = await this.prismaService.aIUsage.findMany({
          where: {
            userId: { not: null },
            usageType: { in: ["QUESTION_GENERATION", "ASSIGNMENT_GENERATION"] },
          },
          select: { userId: true, assignmentId: true },
          distinct: ["userId", "assignmentId"],
          take: PAGE_SIZE,
          skip,
        });
        if (page.length === 0) break;

        const authors = page
          .filter((a) => a.userId !== null && a.assignmentId !== null)
          .map((a) => ({ userId: a.userId, assignmentId: a.assignmentId }));

        const result = await this.batchUpsertAuthors(authors);
        totalCreated += result.created;
        totalUpdated += result.updated;
        totalSkipped += result.skipped;

        hasMore = page.length === PAGE_SIZE;
        if (hasMore) {
          skip += PAGE_SIZE;
        }
      }
      this.logger.log("Processed AI usage authors");

      this.logger.log(
        `Completed scheduled task: Created ${totalCreated} new authors, ` +
          `updated ${totalUpdated} existing, skipped ${totalSkipped} invalid entries`,
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
  async cleanupOldDrafts(
    customDaysOld?: number,
    allowWhenDisabled = false,
  ): Promise<{
    deletedCount: number;
    daysOld: number;
    cutoffDate: string;
  }> {
    if (!allowWhenDisabled && !this.areSchedulersEnabled()) {
      return {
        deletedCount: 0,
        daysOld: customDaysOld === undefined ? 60 : customDaysOld,
        cutoffDate: "DISABLED",
      };
    }

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
  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async updateLLMPricing(allowWhenDisabled = false): Promise<void> {
    if (!allowWhenDisabled && !this.areSchedulersEnabled()) {
      return;
    }

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
    await this.updateLLMPricing(true);
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
    return await this.cleanupOldDrafts(daysOld, true);
  }

  /**
   * Precomputes insights for popular assignments
   * Runs every 3 hours
   *
   * @returns {Promise<void>}
   */
  @Cron(CronExpression.EVERY_6_HOURS)
  async precomputeInsights(allowWhenDisabled = false): Promise<void> {
    if (!allowWhenDisabled && !this.areSchedulersEnabled()) {
      return;
    }

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
    await this.precomputeInsights(true);
  }
}
