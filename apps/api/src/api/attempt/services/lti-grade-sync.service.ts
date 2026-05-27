import { HttpService } from "@nestjs/axios";
import { Injectable, Logger } from "@nestjs/common";
import { LtiSyncStatus, Prisma } from "@prisma/client";
import { firstValueFrom } from "rxjs";
import { AdminEmailService } from "../../../auth/services/admin-email.service";
import { PrismaService } from "../../../database/prisma.service";

interface CreateSyncRequest {
  attemptId: number;
  userId: string;
  assignmentId: number;
  grade: number;
  authCookie: string;
}

interface SyncResult {
  success: boolean;
  syncId: number;
  status: LtiSyncStatus;
  message: string;
  nextRetryAt?: Date;
}

type SyncWithAttempt = Prisma.LtiGradeSyncGetPayload<{
  include: { attempt: true };
}>;

type ErrorHistoryEntry = {
  attempt: number;
  error: string;
  timestamp: string;
  httpStatus?: number;
};

@Injectable()
export class LtiGradeSyncService {
  private readonly logger = new Logger(LtiGradeSyncService.name);
  private readonly ltiGatewayUrl: string;
  private readonly maxRetries = 9;

  // Retry delays in minutes: 5m, 15m, 30m, 1h, 4h, 12h, 24h, 48h, 72h.
  // First slot aligns with the 5-min retry cron so transient failures
  // (gateway blip, momentary LMS slowness) recover on the very next tick.
  // Longer back-offs follow for genuinely flaky upstream LMSes.
  private readonly retryDelays = [5, 15, 30, 60, 240, 720, 1440, 2880, 4320];

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly emailService: AdminEmailService,
  ) {
    this.ltiGatewayUrl = process.env.GRADING_LTI_GATEWAY_URL || "";

    if (!this.ltiGatewayUrl) {
      this.logger.warn(
        "GRADING_LTI_GATEWAY_URL is not set. LTI grade syncing will be disabled.",
      );
    }
  }

  /**
   * Creates a new grade sync record and attempts to sync immediately.
   * If sync fails, schedules retry with exponential backoff.
   *
   * @param request - The sync request containing attempt and grade information
   * @returns Promise<SyncResult> with sync status and details
   */
  async createAndSync(request: CreateSyncRequest): Promise<SyncResult> {
    this.logger.log(
      `Creating grade sync for attempt ${request.attemptId}, grade: ${request.grade}`,
    );

    const sync = await this.prisma.ltiGradeSync.create({
      data: {
        attemptId: request.attemptId,
        userId: request.userId,
        assignmentId: request.assignmentId,
        grade: request.grade,
        authCookie: request.authCookie,
        ltiGatewayUrl: this.ltiGatewayUrl,
        status: LtiSyncStatus.PENDING,
      },
    });

    return await this.attemptSync(sync.id);
  }

  /**
   * Attempts to sync a grade to the LTI gateway.
   * Handles errors, retries, and notifications.
   *
   * @param syncId - The ID of the sync record
   * @returns Promise<SyncResult> with sync outcome
   */
  async attemptSync(syncId: number): Promise<SyncResult> {
    const sync = await this.prisma.ltiGradeSync.findUnique({
      where: { id: syncId },
      include: { attempt: true },
    });

    if (!sync) {
      throw new Error(`Grade sync ${syncId} not found`);
    }

    void this.prisma.ltiGradeSync.update({
      where: { id: syncId },
      data: {
        status: LtiSyncStatus.IN_PROGRESS,
        lastAttemptAt: new Date(),
      },
    });

    const targetUrl = sync.ltiGatewayUrl || this.ltiGatewayUrl;
    const requestStart = Date.now();
    this.logger.debug(
      `LTI gateway PUT → ${targetUrl} (sync ${syncId}, attempt ${sync.attemptId})`,
      {
        sync_id: syncId,
        attempt_id: sync.attemptId,
        grade: sync.grade,
        target_url: targetUrl,
        retry_count: sync.retryCount,
      },
    );

    try {
      const response = await firstValueFrom(
        this.httpService.put(
          targetUrl,
          { score: sync.grade },
          {
            headers: {
              Cookie: `authentication=${sync.authCookie}`,
            },
            // 60s rather than 30s — Instana traces show real LMS responses
            // (e.g. learn.ibm.com POST /mod/lti/service.php) routinely
            // completing in 35-50s. The shorter timeout was aborting calls
            // that would otherwise succeed first try.
            timeout: 60_000,
          },
        ),
      );

      const durationMs = Date.now() - requestStart;
      this.logger.debug(
        `LTI gateway response ${response.status} (took ${durationMs}ms)`,
        {
          sync_id: syncId,
          attempt_id: sync.attemptId,
          status: response.status,
          duration_ms: durationMs,
        },
      );

      if (response.status === 200) {
        await this.prisma.ltiGradeSync.update({
          where: { id: syncId },
          data: {
            status: LtiSyncStatus.SUCCESS,
            completedAt: new Date(),
          },
        });

        this.logger.log(
          `✅ Successfully synced grade for attempt ${sync.attemptId}`,
        );

        return {
          success: true,
          syncId,
          status: LtiSyncStatus.SUCCESS,
          message: "Grade successfully synced to your course platform",
        };
      } else {
        throw new Error(`Unexpected response status: ${response.status}`);
      }
    } catch (error) {
      return await this.handleSyncError(sync, error);
    }
  }

  /**
   * Handles sync errors, schedules retries, and creates error logs.
   *
   * @param sync - The sync record
   * @param error - The error that occurred
   * @returns Promise<SyncResult> with error details and retry schedule
   */
  private async handleSyncError(
    sync: SyncWithAttempt,
    error: unknown,
  ): Promise<SyncResult> {
    const { errorMessage, httpStatus, responseBody, errorStack } =
      this.getErrorDetails(error);

    this.logger.error(
      `Failed to sync grade for attempt ${sync.attemptId}: ${errorMessage}`,
      errorStack,
    );

    await this.prisma.ltiSyncErrorLog.create({
      data: {
        syncId: sync.id,
        attemptNumber: sync.retryCount + 1,
        errorMessage,
        errorStack,
        httpStatus,
        responseBody,
        metadata: {
          attemptId: sync.attemptId,
          grade: sync.grade,
          timestamp: new Date().toISOString(),
        },
      },
    });

    const newRetryCount = sync.retryCount + 1;
    const hasRetriesLeft = newRetryCount < this.maxRetries;

    const errorHistory = this.normalizeErrorHistory(sync.errorHistory);
    errorHistory.push({
      attempt: newRetryCount,
      error: errorMessage,
      timestamp: new Date().toISOString(),
      httpStatus,
    });

    if (hasRetriesLeft) {
      const delayMinutes = this.retryDelays[newRetryCount - 1] || 240;
      const nextRetryAt = new Date(Date.now() + delayMinutes * 60 * 1000);

      await this.prisma.ltiGradeSync.update({
        where: { id: sync.id },
        data: {
          status: LtiSyncStatus.SCHEDULED,
          retryCount: newRetryCount,
          lastError: errorMessage,
          errorHistory,
          nextRetryAt,
        },
      });

      this.logger.warn(
        `⏰ Scheduled retry ${newRetryCount}/${this.maxRetries} for attempt ${
          sync.attemptId
        } at ${nextRetryAt.toISOString()}`,
      );

      await this.createLearnerNotification(
        sync,
        `Retrying grade sync`,
        `We encountered an issue syncing your grade to your course platform. We'll automatically retry ${this.formatRetryTime(
          delayMinutes,
        )}. You don't need to do anything.`,
        nextRetryAt,
      );

      return {
        success: false,
        syncId: sync.id,
        status: LtiSyncStatus.SCHEDULED,
        message: `Grade sync failed. Automatic retry scheduled for ${this.formatRetryTime(
          delayMinutes,
        )}.`,
        nextRetryAt,
      };
    } else {
      await this.prisma.ltiGradeSync.update({
        where: { id: sync.id },
        data: {
          status: LtiSyncStatus.FAILED,
          retryCount: newRetryCount,
          lastError: errorMessage,
          errorHistory,
        },
      });

      this.logger.error(
        `Grade sync permanently failed for attempt ${sync.attemptId} after ${this.maxRetries} attempts`,
      );

      await this.createLearnerNotification(
        sync,
        `Grade sync failed`,
        `We were unable to sync your grade to your course platform after multiple attempts. Your grade is safely stored in our system. Please contact your instructor or support if your grade doesn't appear in your course within 24 hours.`,
        null,
      );

      return {
        success: false,
        syncId: sync.id,
        status: LtiSyncStatus.FAILED,
        message:
          "Grade sync failed after multiple attempts. Please contact support if your grade doesn't appear in your course.",
      };
    }
  }

  /**
   * Creates a notification for the learner about grade sync status.
   * Also sends an email notification.
   *
   * @param sync - The sync record
   * @param title - Notification title
   * @param message - Notification message
   * @param nextRetryAt - Next retry time (if applicable)
   */
  private async createLearnerNotification(
    sync: SyncWithAttempt,
    title: string,
    message: string,
    nextRetryAt: Date | null,
  ): Promise<void> {
    try {
      // Create in-app notification
      await this.prisma.userNotification.create({
        data: {
          userId: sync.userId,
          type: "GRADE_SYNC",
          title,
          message,
          metadata: JSON.stringify({
            syncId: sync.id,
            attemptId: sync.attemptId,
            assignmentId: sync.assignmentId,
            grade: sync.grade,
            retryCount: sync.retryCount,
            nextRetryAt: nextRetryAt?.toISOString(),
          }),
        },
      });

      await this.prisma.ltiGradeSync.update({
        where: { id: sync.id },
        data: {
          learnerNotified: true,
          notificationSentAt: new Date(),
        },
      });

      this.logger.log(
        `📧 Created notification for user ${sync.userId} about sync ${sync.id}`,
      );

      // Send email notification
      await this.sendEmailNotification(sync, title, message, nextRetryAt);
    } catch (error) {
      this.logger.error(
        `Failed to create learner notification for sync ${sync.id}`,
        error,
      );
    }
  }

  /**
   * Sends email notification to learner about grade sync status.
   *
   * @param sync - The sync record
   * @param title - Email subject
   * @param message - Email message
   * @param nextRetryAt - Next retry time (if applicable)
   */
  private async sendEmailNotification(
    sync: SyncWithAttempt,
    title: string,
    message: string,
    nextRetryAt: Date | null,
  ): Promise<void> {
    try {
      const emailBody = this.buildEmailBody(sync, title, message, nextRetryAt);

      const emailSent = await this.emailService.sendGenericEmail(
        sync.userId, // userId is the email address
        `Mark - ${title}`,
        emailBody,
      );

      if (emailSent) {
        this.logger.log(
          `✉️ Sent email notification to ${sync.userId} about sync ${sync.id}`,
        );
      } else {
        this.logger.warn(
          `Failed to send email notification to ${sync.userId} for sync ${sync.id}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Error sending email notification for sync ${sync.id}`,
        error,
      );
    }
  }

  /**
   * Builds the email body for grade sync notifications.
   *
   * @param sync - The sync record
   * @param title - Notification title
   * @param message - Notification message
   * @param nextRetryAt - Next retry time (if applicable)
   * @returns Formatted email body
   */
  private buildEmailBody(
    sync: SyncWithAttempt,
    title: string,
    message: string,
    nextRetryAt: Date | null,
  ): string {
    const baseUrl = process.env.WEB_APP_URL || "http://localhost:3010";
    const resultsUrl = `${baseUrl}/learner/${sync.assignmentId}/successPage/${sync.attemptId}`;
    const gradePercent = Math.round(sync.grade * 100);

    let emailBody = `
${title}

${message}

Assignment Grade: ${gradePercent}%
`;

    if (nextRetryAt) {
      emailBody += `Next Retry Scheduled: ${nextRetryAt.toLocaleString()}
Retry Attempt: ${sync.retryCount + 1}/${this.maxRetries}
`;
    }

    emailBody += `
View Your Results: ${resultsUrl}

---

What This Means:
${this.getStatusExplanation(sync.status, nextRetryAt)}

---

This is an automated notification from Mark.
If you have questions, please contact your instructor.
`;

    return emailBody;
  }

  /**
   * Gets a user-friendly explanation of the sync status.
   *
   * @param status - The current sync status
   * @param nextRetryAt - Next retry time (if applicable)
   * @returns Status explanation
   */
  private getStatusExplanation(
    status: LtiSyncStatus,
    nextRetryAt: Date | null,
  ): string {
    if (status === LtiSyncStatus.SCHEDULED && nextRetryAt) {
      return `We're having temporary difficulty syncing your grade to your course platform. This is usually due to temporary connectivity issues or scheduled maintenance. We'll automatically retry the sync at the scheduled time. You don't need to do anything - your grade is safely stored in our system.`;
    }

    if (status === LtiSyncStatus.FAILED) {
      return `After multiple attempts, we were unable to sync your grade to your course platform. This may be due to a configuration issue or extended outage. Your grade is safely stored in our system. If your grade doesn't appear in your course within 24 hours, please contact your instructor or support team.`;
    }

    return `Your grade sync is being processed.`;
  }

  /**
   * Processes all scheduled retries that are due.
   * Should be called periodically by a cron job or scheduler.
   *
   * @returns Promise<number> - Number of syncs processed
   */
  async processScheduledRetries(): Promise<number> {
    const now = new Date();

    const dueRetries = await this.prisma.ltiGradeSync.findMany({
      where: {
        status: LtiSyncStatus.SCHEDULED,
        nextRetryAt: {
          lte: now,
        },
      },
      take: 50,
    });

    this.logger.log(
      `Processing ${dueRetries.length} scheduled grade sync retries`,
    );

    let successCount = 0;
    let failureCount = 0;

    for (const sync of dueRetries) {
      try {
        const result = await this.attemptSync(sync.id);
        if (result.success) {
          successCount++;
        } else {
          failureCount++;
        }
      } catch (error) {
        this.logger.error(`Error processing retry for sync ${sync.id}`, error);
        failureCount++;
      }
    }

    this.logger.log(
      `Completed retry batch: ${successCount} successful, ${failureCount} failed`,
    );

    return dueRetries.length;
  }

  /**
   * Gets the current sync status for an attempt.
   *
   * @param attemptId - The attempt ID
   * @returns Promise with sync status information
   */
  async getSyncStatus(attemptId: number) {
    const sync = await this.prisma.ltiGradeSync.findFirst({
      where: { attemptId },
      orderBy: { createdAt: "desc" },
      include: {
        errorLogs: {
          orderBy: { timestamp: "desc" },
          take: 5,
        },
      },
    });

    if (!sync) {
      return null;
    }

    return {
      id: sync.id,
      status: sync.status,
      grade: sync.grade,
      retryCount: sync.retryCount,
      maxRetries: sync.maxRetries,
      lastError: sync.lastError,
      nextRetryAt: sync.nextRetryAt,
      completedAt: sync.completedAt,
      createdAt: sync.createdAt,
      errorLogs: sync.errorLogs,
      canRetry: sync.retryCount < sync.maxRetries,
    };
  }

  /**
   * Manually retry a failed sync (for admin use).
   *
   * @param syncId - The sync ID to retry
   * @returns Promise<SyncResult>
   */
  async manualRetry(syncId: number): Promise<SyncResult> {
    const sync = await this.prisma.ltiGradeSync.findUnique({
      where: { id: syncId },
    });

    if (!sync) {
      throw new Error(`Grade sync ${syncId} not found`);
    }

    if (sync.status === LtiSyncStatus.SUCCESS) {
      return {
        success: true,
        syncId,
        status: LtiSyncStatus.SUCCESS,
        message: "Grade already successfully synced",
      };
    }

    this.logger.log(`🔄 Manual retry initiated for sync ${syncId} by admin`);

    return await this.attemptSync(syncId);
  }

  /**
   * Helper to extract error message from various error types.
   */
  private extractErrorMessage(error: unknown): string {
    const responseMessage = this.getResponseMessage(error);
    if (responseMessage) {
      return responseMessage;
    }

    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === "string") {
      return error;
    }

    return "Unknown error occurred";
  }

  private getErrorDetails(error: unknown): {
    errorMessage: string;
    httpStatus?: number;
    responseBody?: string;
    errorStack?: string;
  } {
    const response = this.getErrorResponse(error);
    const httpStatus = response?.status;
    const responseBody = response
      ? this.safeStringify(response.data)
      : undefined;
    const errorMessage = this.extractErrorMessage(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    return { errorMessage, httpStatus, responseBody, errorStack };
  }

  private getErrorResponse(
    error: unknown,
  ): { status?: number; data?: unknown } | null {
    if (!this.isRecord(error)) {
      return null;
    }

    const response = error.response;
    if (!this.isRecord(response)) {
      return null;
    }

    const status =
      typeof response.status === "number" ? response.status : undefined;
    const data = "data" in response ? response.data : undefined;

    return { status, data };
  }

  private getResponseMessage(error: unknown): string | null {
    const response = this.getErrorResponse(error);
    if (!response || !this.isRecord(response.data)) {
      return null;
    }

    const message = response.data.message;
    return typeof message === "string" ? message : null;
  }

  private safeStringify(value: unknown): string | undefined {
    if (typeof value === "string") {
      return value;
    }

    if (value === undefined) {
      return undefined;
    }

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private normalizeErrorHistory(
    history: Prisma.JsonValue,
  ): ErrorHistoryEntry[] {
    if (!Array.isArray(history)) {
      return [];
    }

    return history.flatMap((entry) => {
      if (!this.isRecord(entry)) {
        return [];
      }

      const attempt = entry.attempt;
      const error = entry.error;
      const timestamp = entry.timestamp;
      const httpStatus = entry.httpStatus;

      if (
        typeof attempt !== "number" ||
        typeof error !== "string" ||
        typeof timestamp !== "string"
      ) {
        return [];
      }

      const normalized: ErrorHistoryEntry = { attempt, error, timestamp };

      if (typeof httpStatus === "number") {
        normalized.httpStatus = httpStatus;
      }

      return [normalized];
    });
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  /**
   * Helper to format retry time in human-readable format.
   */
  private formatRetryTime(minutes: number): string {
    if (minutes < 60) {
      return `in ${minutes} minute${minutes > 1 ? "s" : ""}`;
    }
    const hours = Math.floor(minutes / 60);
    return `in ${hours} hour${hours > 1 ? "s" : ""}`;
  }

  /**
   * Gets system-wide sync statistics for monitoring.
   * Returns counts of syncs in different states.
   */
  async getSystemStats() {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const [failedCount, scheduledCount, successCount, pendingCount] =
      await Promise.all([
        this.prisma.ltiGradeSync.count({
          where: {
            status: LtiSyncStatus.FAILED,
            createdAt: { gte: oneHourAgo },
          },
        }),
        this.prisma.ltiGradeSync.count({
          where: { status: LtiSyncStatus.SCHEDULED },
        }),
        this.prisma.ltiGradeSync.count({
          where: {
            status: LtiSyncStatus.SUCCESS,
            createdAt: { gte: oneHourAgo },
          },
        }),
        this.prisma.ltiGradeSync.count({
          where: { status: LtiSyncStatus.PENDING },
        }),
      ]);

    return {
      failedCount,
      scheduledCount,
      successCount,
      pendingCount,
      total: failedCount + scheduledCount + successCount + pendingCount,
    };
  }
}
