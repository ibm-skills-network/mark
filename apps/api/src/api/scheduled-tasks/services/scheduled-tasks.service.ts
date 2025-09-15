import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../../prisma.service";
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

  async onApplicationBootstrap() {
    this.logger.log("Application started - running initial tasks");
    // Run initial tasks on startup
    await Promise.all([this.migrateExistingAuthors(), this.updateLLMPricing()]);
  }

  // @Cron(CronExpression.EVERY_DAY_AT_2AM)
  // async republishTopAssignments() {
  //   this.logger.log('Starting scheduled task: Republish top 10 used assignments');

  //   try {
  //     // Find top 10 most attempted assignments
  //     const topAssignments = await this.prismaService.assignmentAttempt.groupBy({
  //       by: ['assignmentId'],
  //       _count: {
  //         assignmentId: true,
  //       },
  //       orderBy: {
  //         _count: {
  //           assignmentId: 'desc',
  //         },
  //       },
  //       take: 10,
  //     });

  //     this.logger.log(`Found ${topAssignments.length} top assignments to republish`);

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
  //       await this.prismaService.publishJob.create({
  //         data: {
  //           userId: 'SYSTEM_SCHEDULED_TASK',
  //           assignmentId: assignment.assignmentId,
  //           status: 'Pending',
  //           progress: 'Scheduled republishing of top assignment',
  //           percentage: 0,
  //         },
  //       });

  //       this.logger.log(`Republished assignment ${assignment.assignmentId} with ${assignment._count.assignmentId} attempts`);
  //     }

  //     this.logger.log('Completed scheduled task: Republish top 10 used assignments');
  //   } catch (error) {
  //     this.logger.error('Error in republishTopAssignments:', error);
  //   }
  // }

  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async migrateExistingAuthors() {
    this.logger.log(
      "Starting scheduled task: Migrate existing authors to AssignmentAuthor table",
    );

    try {
      // Find authors from Report table where author=true
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

      // Find authors from AIUsage table (users who generated content for assignments)
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

      // Find authors from Job table (users who created assignments)
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

      // Find authors from publishJob table (users who published assignments)
      const publishJobAuthors = await this.prismaService.publishJob.findMany({
        where: {
          userId: {
            not: "SYSTEM_SCHEDULED_TASK", // Exclude system tasks
          },
        },
        select: {
          userId: true,
          assignmentId: true,
        },
        distinct: ["userId", "assignmentId"],
      });
      // Combine all potential authors
      const allPotentialAuthors = [
        ...reportAuthors.map((r) => ({
          userId: r.reporterId,
          assignmentId: r?.assignmentId ?? null,
        })),
        ...aiUsageAuthors.map((a) => ({
          userId: a?.userId ?? null,
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

      // Remove duplicates
      const uniqueAuthors = allPotentialAuthors.filter(
        (author, index, self) =>
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

      let migratedCount = 0;
      let skippedCount = 0;

      // Insert authors into AssignmentAuthor table (ignore duplicates)
      for (const author of uniqueAuthors) {
        try {
          await this.prismaService.assignmentAuthor.create({
            data: {
              userId: author.userId,
              assignmentId: author.assignmentId,
            },
          });
          migratedCount++;
        } catch {
          // Skip if already exists or assignment doesn't exist
          skippedCount++;
        }
      }

      this.logger.log(
        `Completed scheduled task: Migrated ${migratedCount} authors, skipped ${skippedCount} duplicates/invalid entries`,
      );
    } catch (error) {
      this.logger.error("Error in migrateExistingAuthors:", error);
    }
  }

  // @Cron(CronExpression.EVERY_WEEK)
  // async cleanupOldPublishJobs() {
  //   this.logger.log('Starting scheduled task: Cleanup old publish jobs');

  //   try {
  //     // Delete completed publish jobs older than 30 days
  //     const thirtyDaysAgo = new Date();
  //     thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  //     const deletedJobs = await this.prismaService.publishJob.deleteMany({
  //       where: {
  //         status: 'Completed',
  //         createdAt: {
  //           lt: thirtyDaysAgo,
  //         },
  //       },
  //     });

  //     this.logger.log(`Cleaned up ${deletedJobs.count} old publish jobs`);
  //   } catch (error) {
  //     this.logger.error('Error in cleanupOldPublishJobs:', error);
  //   }
  // }

  @Cron(CronExpression.EVERY_WEEK) // Every Sunday at midnight
  async cleanupOldDrafts(customDaysOld?: number) {
    const daysOld = customDaysOld === undefined ? 60 : customDaysOld; // Default to 60 days
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
        // Delete all drafts
        whereCondition = {};
        logMessage = "Looking for ALL drafts to delete";
      } else {
        // Calculate date for the specified number of days ago
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

      // Find drafts based on condition
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
        this.logger.log(
          isDeleteAll ? "No drafts to delete" : "No old drafts to cleanup",
        );
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

      // Log details of drafts to be deleted for audit purposes
      for (const draft of oldDrafts) {
        this.logger.log(
          `Preparing to delete draft: ID=${draft.id}, Name="${draft.draftName}", ` +
            `User=${draft.userId}, Assignment="${draft.assignment.name}", ` +
            `Created=${draft.createdAt.toISOString()}`,
        );
      }

      // Delete the drafts
      const deletedDrafts = await this.prismaService.assignmentDraft.deleteMany(
        {
          where: whereCondition,
        },
      );

      this.logger.log(
        `Completed ${
          customDaysOld === undefined ? "scheduled" : "manual"
        } task: Deleted ${deletedDrafts.count} ${
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

  @Cron("0 */6 * * *") // Every 6 hours
  async updateLLMPricing() {
    this.logger.log("Starting scheduled task: Update LLM pricing");

    try {
      // Fetch current pricing from OpenAI
      const currentPricing = await this.llmPricingService.fetchCurrentPricing();

      if (currentPricing.length === 0) {
        this.logger.warn("No pricing data fetched from OpenAI");
        return;
      }

      // Update pricing history
      const updatedCount =
        await this.llmPricingService.updatePricingHistory(currentPricing);

      this.logger.log(
        `Completed scheduled task: Updated pricing for ${updatedCount} models`,
      );

      // Log pricing statistics
      const stats = await this.llmPricingService.getPricingStatistics();
      this.logger.log(
        `Pricing statistics: ${stats.totalModels} models, ${stats.activePricingRecords} active pricing records`,
      );
    } catch (error) {
      this.logger.error("Error in updateLLMPricing:", error);
    }
  }

  async manualUpdateLLMPricing() {
    this.logger.log("Manual update of LLM pricing requested");
    await this.updateLLMPricing();
  }

  async manualCleanupOldDrafts(daysOld?: number) {
    this.logger.log(
      `Manual cleanup of old drafts requested${
        daysOld ? ` (${daysOld} days old)` : ""
      }`,
    );
    return await this.cleanupOldDrafts(daysOld);
  }

  @Cron(CronExpression.EVERY_3_HOURS) // Every 3 hours
  async precomputeInsights() {
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

  async manualPrecomputeInsights() {
    this.logger.log("Manual precomputation of insights requested");
    await this.precomputeInsights();
  }
}
