import {
  Controller,
  DefaultValuePipe,
  Get,
  Logger,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { AdminOrJobQueueSecretGuard } from "src/auth/guards/admin-or-job-queue-secret.guard";
import { LtiGradeSyncService } from "../services/lti-grade-sync.service";
import { PrismaService } from "../../../database/prisma.service";
import { LtiSyncStatus } from "@prisma/client";

const MAX_PAGE_LIMIT = 100;

/**
 * Admin controller for monitoring and managing LTI grade synchronization.
 * Provides endpoints for viewing sync status, retry management, and health monitoring.
 */
@ApiTags("Admin - LTI Grade Sync")
// Admin session or the internal job-queue secret (used by the lti-sync-drain
// CronJob to call retry). Applied at class level so new routes are gated too.
@UseGuards(AdminOrJobQueueSecretGuard)
@ApiBearerAuth()
@Controller("admin/lti-sync")
export class LtiSyncAdminController {
  private readonly logger = new Logger(LtiSyncAdminController.name);

  constructor(
    private readonly ltiGradeSyncService: LtiGradeSyncService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Get system-wide sync statistics
   */
  @Get("stats")
  @ApiOperation({ summary: "Get LTI grade sync statistics" })
  @ApiResponse({ status: 200, description: "Sync statistics retrieved" })
  async getStats() {
    const stats = await this.ltiGradeSyncService.getSystemStats();

    const [recentFailures, oldestScheduled] = await Promise.all([
      this.prisma.ltiGradeSync.findMany({
        where: {
          status: LtiSyncStatus.FAILED,
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          attempt: {
            select: {
              assignmentId: true,
              userId: true,
            },
          },
        },
      }),
      this.prisma.ltiGradeSync.findFirst({
        where: { status: LtiSyncStatus.SCHEDULED },
        orderBy: { nextRetryAt: "asc" },
      }),
    ]);

    return {
      ...stats,
      recentFailures: recentFailures.map((sync) => ({
        id: sync.id,
        attemptId: sync.attemptId,
        userId: sync.userId,
        assignmentId: sync.assignmentId,
        grade: sync.grade,
        retryCount: sync.retryCount,
        lastError: sync.lastError,
        createdAt: sync.createdAt,
      })),
      nextScheduledRetry: oldestScheduled?.nextRetryAt || null,
    };
  }

  /**
   * Get all failed syncs that need attention
   */
  @Get("failed")
  @ApiOperation({ summary: "Get all permanently failed syncs" })
  @ApiResponse({ status: 200, description: "Failed syncs retrieved" })
  async getFailedSyncs(
    @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    const pageNumber = Math.max(1, page);
    const limitNumber = Math.min(Math.max(1, limit), MAX_PAGE_LIMIT);
    const skip = (pageNumber - 1) * limitNumber;

    const [syncs, total] = await Promise.all([
      this.prisma.ltiGradeSync.findMany({
        where: { status: LtiSyncStatus.FAILED },
        orderBy: { createdAt: "desc" },
        skip,
        take: limitNumber,
        include: {
          attempt: {
            select: {
              assignmentId: true,
              userId: true,
              grade: true,
              submitted: true,
            },
          },
          errorLogs: {
            orderBy: { timestamp: "desc" },
            take: 3,
          },
        },
      }),
      this.prisma.ltiGradeSync.count({
        where: { status: LtiSyncStatus.FAILED },
      }),
    ]);

    return {
      syncs,
      pagination: {
        page: pageNumber,
        limit: limitNumber,
        total,
        totalPages: Math.ceil(total / limitNumber),
      },
    };
  }

  /**
   * Get sync status for a specific attempt
   */
  @Get("attempt/:attemptId")
  @ApiOperation({ summary: "Get sync status for an attempt" })
  @ApiResponse({ status: 200, description: "Sync status retrieved" })
  @ApiResponse({ status: 404, description: "Sync not found" })
  async getSyncForAttempt(@Param("attemptId", ParseIntPipe) attemptId: number) {
    return await this.ltiGradeSyncService.getSyncStatus(attemptId);
  }

  /**
   * Manually retry a failed sync
   */
  @Post("retry/:syncId")
  @ApiOperation({ summary: "Manually retry a failed sync" })
  @ApiResponse({ status: 200, description: "Sync retry initiated" })
  @ApiResponse({ status: 404, description: "Sync not found" })
  async retrySync(@Param("syncId", ParseIntPipe) syncId: number) {
    this.logger.log(`Manual LTI sync retry requested for sync ${syncId}`);
    const result = await this.ltiGradeSyncService.manualRetry(syncId);
    this.logger.log(
      `Manual LTI sync retry for sync ${syncId}: success=${String(result.success)} status=${result.status}`,
    );

    return {
      success: result.success,
      message: result.message,
      status: result.status,
      nextRetryAt: result.nextRetryAt,
    };
  }

  /**
   * Get detailed error logs for a sync
   */
  @Get(":syncId/errors")
  @ApiOperation({ summary: "Get error logs for a sync" })
  @ApiResponse({ status: 200, description: "Error logs retrieved" })
  async getErrorLogs(@Param("syncId", ParseIntPipe) syncId: number) {
    const errors = await this.prisma.ltiSyncErrorLog.findMany({
      where: { syncId },
      orderBy: { timestamp: "desc" },
    });

    return { errors };
  }

  /**
   * Get syncs that are scheduled for retry
   */
  @Get("scheduled")
  @ApiOperation({ summary: "Get all scheduled retries" })
  @ApiResponse({ status: 200, description: "Scheduled syncs retrieved" })
  async getScheduledSyncs() {
    const syncs = await this.prisma.ltiGradeSync.findMany({
      where: { status: LtiSyncStatus.SCHEDULED },
      orderBy: { nextRetryAt: "asc" },
      take: 100,
      include: {
        attempt: {
          select: {
            assignmentId: true,
            userId: true,
          },
        },
      },
    });

    return {
      syncs: syncs.map((sync) => ({
        id: sync.id,
        attemptId: sync.attemptId,
        userId: sync.userId,
        assignmentId: sync.assignmentId,
        grade: sync.grade,
        retryCount: sync.retryCount,
        maxRetries: sync.maxRetries,
        nextRetryAt: sync.nextRetryAt,
        lastError: sync.lastError,
      })),
      count: syncs.length,
    };
  }

  /**
   * Health check endpoint for monitoring
   */
  @Get("health")
  @ApiOperation({ summary: "Get sync system health status" })
  @ApiResponse({ status: 200, description: "Health status retrieved" })
  async getHealth() {
    const stats = await this.ltiGradeSyncService.getSystemStats();

    const failureRate =
      stats.total > 0 ? (stats.failedCount / stats.total) * 100 : 0;

    const health = {
      status:
        failureRate > 10 ? "degraded" : failureRate > 5 ? "warning" : "healthy",
      stats,
      failureRate: `${failureRate.toFixed(2)}%`,
      alerts: [] as string[],
    };

    if (stats.failedCount > 10) {
      health.alerts.push(`High number of failed syncs: ${stats.failedCount}`);
    }

    if (stats.scheduledCount > 50) {
      health.alerts.push(
        `High number of scheduled retries: ${stats.scheduledCount}`,
      );
    }

    return health;
  }
}
