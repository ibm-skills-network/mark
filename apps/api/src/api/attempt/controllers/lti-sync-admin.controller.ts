import { Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { LtiGradeSyncService } from "../services/lti-grade-sync.service";
import { PrismaService } from "../../../database/prisma.service";
import { LtiSyncStatus } from "@prisma/client";

/**
 * Admin controller for monitoring and managing LTI grade synchronization.
 * Provides endpoints for viewing sync status, retry management, and health monitoring.
 */
@ApiTags("Admin - LTI Grade Sync")
@Controller("admin/lti-sync")
export class LtiSyncAdminController {
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
    @Query("page") page = "1",
    @Query("limit") limit = "50",
  ) {
    const pageNumber = Number.parseInt(page, 10);
    const limitNumber = Number.parseInt(limit, 10);
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
  async getSyncForAttempt(@Param("attemptId") attemptId: string) {
    return await this.ltiGradeSyncService.getSyncStatus(
      Number.parseInt(attemptId, 10),
    );
  }

  /**
   * Manually retry a failed sync
   */
  @Post("retry/:syncId")
  @ApiOperation({ summary: "Manually retry a failed sync" })
  @ApiResponse({ status: 200, description: "Sync retry initiated" })
  @ApiResponse({ status: 404, description: "Sync not found" })
  async retrySync(@Param("syncId") syncId: string) {
    const result = await this.ltiGradeSyncService.manualRetry(
      Number.parseInt(syncId, 10),
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
  async getErrorLogs(@Param("syncId") syncId: string) {
    const errors = await this.prisma.ltiSyncErrorLog.findMany({
      where: { syncId: Number.parseInt(syncId, 10) },
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
