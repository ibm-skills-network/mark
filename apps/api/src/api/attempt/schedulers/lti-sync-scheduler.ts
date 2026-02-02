import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { LtiGradeSyncService } from "../services/lti-grade-sync.service";

/**
 * Scheduler for processing LTI grade sync retries.
 * Runs periodically to check for and process scheduled retries.
 */
@Injectable()
export class LtiSyncScheduler {
  private readonly logger = new Logger(LtiSyncScheduler.name);
  private isProcessing = false;

  constructor(private readonly ltiGradeSyncService: LtiGradeSyncService) {}

  /**
   * Process scheduled LTI grade sync retries every 5 minutes.
   * This balances timely retry processing with minimal server load.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleScheduledRetries() {
    if (this.isProcessing) {
      this.logger.debug("Skipping scheduled retries - already processing");
      return;
    }

    this.isProcessing = true;

    try {
      const processed =
        await this.ltiGradeSyncService.processScheduledRetries();

      if (processed > 0) {
        this.logger.log(
          `✅ Processed ${processed} scheduled grade sync retries`,
        );
      }
    } catch (error) {
      this.logger.error("Error processing scheduled retries", error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Health check that runs every hour to report on sync status.
   * Useful for monitoring and alerting.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async reportSyncHealth() {
    try {
      const stats = await this.ltiGradeSyncService.getSystemStats();

      if (stats.failedCount > 0 || stats.scheduledCount > 10) {
        this.logger.warn(
          `⚠️  Grade Sync Health: ` +
            `${stats.failedCount} failed, ` +
            `${stats.scheduledCount} scheduled, ` +
            `${stats.successCount} successful (last hour)`,
        );
      }
    } catch (error) {
      this.logger.error("Error generating sync health report", error);
    }
  }
}
