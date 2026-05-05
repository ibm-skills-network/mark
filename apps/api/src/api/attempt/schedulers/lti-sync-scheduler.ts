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

  private areSchedulersEnabled(): boolean {
    return process.env.ENABLE_JOB_SCHEDULERS === "true";
  }

  /**
   * Process scheduled LTI grade sync retries every 5 minutes.
   * This balances timely retry processing with minimal server load.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleScheduledRetries() {
    if (!this.areSchedulersEnabled()) {
      return;
    }
    const tickStart = Date.now();
    this.logger.debug("cron_tick handleScheduledRetries");

    if (this.isProcessing) {
      this.logger.warn(
        "Skipping scheduled retries - previous run still in progress",
      );
      return;
    }

    this.isProcessing = true;

    try {
      const processed =
        await this.ltiGradeSyncService.processScheduledRetries();

      if (processed > 0) {
        this.logger.log(
          `✅ Processed ${processed} scheduled grade sync retries (took ${Date.now() - tickStart}ms)`,
        );
      } else {
        this.logger.debug(
          `cron_tick handleScheduledRetries: no work (took ${Date.now() - tickStart}ms)`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Error processing scheduled retries (took ${Date.now() - tickStart}ms)`,
        error,
      );
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
    if (!this.areSchedulersEnabled()) {
      return;
    }
    this.logger.debug("cron_tick reportSyncHealth");
    try {
      const stats = await this.ltiGradeSyncService.getSystemStats();

      this.logger.log("grade_sync_health snapshot", {
        failed_count: stats.failedCount,
        scheduled_count: stats.scheduledCount,
        success_count: stats.successCount,
      });

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
