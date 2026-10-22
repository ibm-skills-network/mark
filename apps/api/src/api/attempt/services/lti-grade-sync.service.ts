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

type SupersedingSync = {
  id: number;
  grade: number;
};

type ResourceLink = {
  groupId?: string;
  outcomeServiceUrl?: string;
};

/**
 * How long a row may sit PENDING (never claimed) or IN_PROGRESS (claimed, no
 * outcome written) before it is treated as orphaned, e.g. by a pod killed
 * mid-send, and becomes eligible for a retry. Well above the 90s gateway
 * timeout so a send that is still in flight is never claimed twice.
 * Mirrored in scripts/lti-sync-drain.js.
 */
export const ORPHANED_SYNC_STALE_MS = 10 * 60 * 1000;

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

    // Inserted already claimed: if this process dies before an outcome is
    // written, the row is a stale IN_PROGRESS row that the retry drain
    // recovers, instead of a PENDING row nothing ever looks at.
    const sync = await this.prisma.ltiGradeSync.create({
      data: {
        attemptId: request.attemptId,
        userId: request.userId,
        assignmentId: request.assignmentId,
        grade: request.grade,
        authCookie: request.authCookie,
        ltiGatewayUrl: this.ltiGatewayUrl,
        status: LtiSyncStatus.IN_PROGRESS,
        lastAttemptAt: new Date(),
      },
      include: { attempt: true },
    });

    return await this.sendGrade(sync);
  }

  /**
   * Retries an existing sync row. Claims it atomically so two workers can't
   * send it twice, and closes it unsent when a newer SUCCESS already covers
   * the same gradebook column.
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

    if (sync.status === LtiSyncStatus.SUCCESS) {
      return {
        success: true,
        syncId,
        status: LtiSyncStatus.SUCCESS,
        message: "Grade already successfully synced",
      };
    }

    const claimedAt = new Date();
    const claim = await this.prisma.ltiGradeSync.updateMany({
      where: this.claimableWhere(syncId, claimedAt),
      data: { status: LtiSyncStatus.IN_PROGRESS, lastAttemptAt: claimedAt },
    });

    if (claim.count === 0) {
      this.logger.log(
        `LTI grade sync ${syncId} not claimed: another send is in flight`,
        {
          sync_id: syncId,
          attempt_id: sync.attemptId,
          assignment_id: sync.assignmentId,
          status: sync.status,
          last_attempt_at: sync.lastAttemptAt?.toISOString() ?? null,
        },
      );
      return {
        success: false,
        syncId,
        status: LtiSyncStatus.IN_PROGRESS,
        message: "Grade sync is already in progress",
      };
    }

    const superseding = await this.findSupersedingSync(sync);
    if (superseding) {
      return await this.closeAsSuperseded(sync, superseding);
    }

    return await this.sendGrade(sync);
  }

  /**
   * Rows a send may claim. PENDING is only claimable once orphaned: current
   * code never leaves a row PENDING, but a pod still running older code
   * keeps its row PENDING while its own send is in flight. IN_PROGRESS is
   * only claimable once stale, so an in-flight send is never doubled.
   */
  private claimableWhere(
    syncId: number,
    now: Date,
  ): Prisma.LtiGradeSyncWhereInput {
    const staleBefore = new Date(now.getTime() - ORPHANED_SYNC_STALE_MS);
    return {
      id: syncId,
      OR: [
        { status: { in: [LtiSyncStatus.SCHEDULED, LtiSyncStatus.FAILED] } },
        { status: LtiSyncStatus.PENDING, createdAt: { lt: staleBefore } },
        ...this.staleInProgressWhere(staleBefore),
      ],
    };
  }

  private staleInProgressWhere(
    staleBefore: Date,
  ): Prisma.LtiGradeSyncWhereInput[] {
    return [
      { status: LtiSyncStatus.IN_PROGRESS, lastAttemptAt: { lt: staleBefore } },
      {
        status: LtiSyncStatus.IN_PROGRESS,
        lastAttemptAt: null,
        updatedAt: { lt: staleBefore },
      },
    ];
  }

  /**
   * A newer SUCCESS for the same learner, assignment and resource link means
   * the LMS already holds a grade at least as current as this row's (each
   * row carries the learner's best grade at the time it was created).
   * Sending this older row would overwrite that grade with a stale one.
   */
  private async findSupersedingSync(
    sync: SyncWithAttempt,
  ): Promise<SupersedingSync | null> {
    const newer = await this.prisma.ltiGradeSync.findMany({
      where: {
        userId: sync.userId,
        assignmentId: sync.assignmentId,
        status: LtiSyncStatus.SUCCESS,
        id: { gt: sync.id },
      },
      select: { id: true, grade: true, authCookie: true },
      orderBy: { id: "desc" },
      take: 100,
    });

    if (newer.length === 0) {
      return null;
    }

    const link = this.resourceLinkOf(sync.authCookie, sync.id);
    const match = newer.find((candidate) =>
      this.isSameResourceLink(
        link,
        this.resourceLinkOf(candidate.authCookie, candidate.id),
      ),
    );

    return match ? { id: match.id, grade: match.grade } : null;
  }

  /**
   * The gradebook column a row posts to, read from the stored session JWT.
   * lis_result_sourcedid is deliberately not used: some LMSes issue a new
   * one on every launch for the same learner and column.
   */
  private resourceLinkOf(authCookie: string, syncId: number): ResourceLink {
    const payloadSegment = authCookie.split(".")[1];
    if (!payloadSegment) {
      return {};
    }

    try {
      const payload: unknown = JSON.parse(
        Buffer.from(payloadSegment, "base64url").toString("utf8"),
      );
      if (!this.isRecord(payload)) {
        return {};
      }
      const groupId = payload.groupID;
      const outcomeServiceUrl = payload.lis_outcome_service_url;
      return {
        groupId: typeof groupId === "string" ? groupId : undefined,
        outcomeServiceUrl:
          typeof outcomeServiceUrl === "string" ? outcomeServiceUrl : undefined,
      };
    } catch (error) {
      // Not fatal: the row is then matched on learner and assignment alone.
      this.logger.warn(`LTI grade sync ${syncId}: unreadable session claims`, {
        sync_id: syncId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {};
    }
  }

  /** Fields missing on either side are not compared. */
  private isSameResourceLink(a: ResourceLink, b: ResourceLink): boolean {
    if (a.groupId && b.groupId && a.groupId !== b.groupId) {
      return false;
    }
    if (
      a.outcomeServiceUrl &&
      b.outcomeServiceUrl &&
      a.outcomeServiceUrl !== b.outcomeServiceUrl
    ) {
      return false;
    }
    return true;
  }

  private async closeAsSuperseded(
    sync: SyncWithAttempt,
    superseding: SupersedingSync,
  ): Promise<SyncResult> {
    const reason = `superseded by sync ${superseding.id} (grade ${superseding.grade}); not sent`;
    const errorHistory = this.normalizeErrorHistory(sync.errorHistory);
    errorHistory.push({
      attempt: sync.retryCount,
      error: reason,
      timestamp: new Date().toISOString(),
    });

    await this.prisma.ltiGradeSync.update({
      where: { id: sync.id },
      data: {
        status: LtiSyncStatus.FAILED,
        lastError: reason,
        errorHistory,
        nextRetryAt: null,
        completedAt: new Date(),
      },
    });

    this.logger.log(
      `LTI grade sync ${sync.id} closed: superseded by sync ${superseding.id}`,
      {
        sync_id: sync.id,
        attempt_id: sync.attemptId,
        assignment_id: sync.assignmentId,
        grade: sync.grade,
        previous_status: sync.status,
        superseded_by_sync_id: superseding.id,
        superseded_by_grade: superseding.grade,
      },
    );

    return {
      success: false,
      syncId: sync.id,
      status: LtiSyncStatus.FAILED,
      message:
        "Grade sync superseded by a newer synced grade for the same course; not resent",
    };
  }

  /**
   * Sends a claimed row's grade to the LTI gateway and records the outcome.
   */
  private async sendGrade(sync: SyncWithAttempt): Promise<SyncResult> {
    const syncId = sync.id;
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
            // 90s rather than 60s — Instana flags the gateway's inbound
            // PUT /grade span as errored whenever we abort the connection
            // early, and real LMS responses (e.g. learn.ibm.com POST
            // /mod/lti/service.php) sometimes run past 60s. A longer ceiling
            // lets slow-but-valid calls finish instead of surfacing as
            // gateway errors. The gateway's own LMS call is unbounded, so
            // this is the binding limit on the chain.
            timeout: 90_000,
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
        LtiSyncStatus.SCHEDULED,
        // Email only the first failure. Later retries update the in-app
        // notification, and the learner hears again only if every retry fails.
        newRetryCount === 1,
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
        LtiSyncStatus.FAILED,
        true,
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
   * Creates a notification for the learner about grade sync status, and
   * optionally emails it. A single failed sync sends at most two emails: one
   * when it first fails and one if it fails permanently.
   *
   * @param sync - The sync record
   * @param title - Notification title
   * @param message - Notification message
   * @param nextRetryAt - Next retry time (if applicable)
   * @param status - The status the sync was just moved to
   * @param sendEmail - Whether to email the learner as well
   */
  private async createLearnerNotification(
    sync: SyncWithAttempt,
    title: string,
    message: string,
    nextRetryAt: Date | null,
    status: LtiSyncStatus,
    sendEmail: boolean,
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

      if (sendEmail) {
        await this.sendEmailNotification(
          sync,
          title,
          message,
          nextRetryAt,
          status,
        );
      }
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
   * @param status - The status the sync was just moved to
   */
  private async sendEmailNotification(
    sync: SyncWithAttempt,
    title: string,
    message: string,
    nextRetryAt: Date | null,
    status: LtiSyncStatus,
  ): Promise<void> {
    try {
      const emailBody = this.buildEmailBody(
        sync,
        title,
        message,
        nextRetryAt,
        status,
      );

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
        this.logger.error(
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
   * @param status - The status the sync was just moved to
   * @returns Formatted email body
   */
  private buildEmailBody(
    sync: SyncWithAttempt,
    title: string,
    message: string,
    nextRetryAt: Date | null,
    status: LtiSyncStatus,
  ): string {
    const resultsUrl = this.emailService.learnerResultsUrl(
      sync.assignmentId,
      sync.attemptId,
    );
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
${this.getStatusExplanation(status, nextRetryAt)}

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
   * Processes scheduled retries that are due, plus rows orphaned before
   * they reached SCHEDULED (stale PENDING or IN_PROGRESS).
   * Should be called periodically by a cron job or scheduler.
   *
   * @returns Promise<number> - Number of syncs processed
   */
  async processScheduledRetries(): Promise<number> {
    const now = new Date();

    const staleBefore = new Date(now.getTime() - ORPHANED_SYNC_STALE_MS);

    const dueRetries = await this.prisma.ltiGradeSync.findMany({
      where: {
        OR: [
          { status: LtiSyncStatus.SCHEDULED, nextRetryAt: { lte: now } },
          { status: LtiSyncStatus.PENDING, createdAt: { lt: staleBefore } },
          ...this.staleInProgressWhere(staleBefore),
        ],
      },
      orderBy: { id: "asc" },
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
