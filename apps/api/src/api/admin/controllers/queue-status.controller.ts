import {
  Controller,
  Delete,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { AdminGuard } from "src/auth/guards/admin.guard";
import {
  UserRole,
  UserSessionRequest,
} from "src/auth/interfaces/user.session.interface";
import { Roles } from "src/auth/role/roles.global.guard";
import { JOB_QUEUE_NAMES } from "../../../job-queue/job-queue.constants";
import {
  ActiveJobDto,
  FailedJobDto,
  QueueStatDto,
  QueueStatusService,
  RedisHealthDto,
  WorkerDto,
} from "../services/queue-status.service";

const DEFAULT_FAILED_LIMIT = 25;
const DEFAULT_ACTIVE_LIMIT = 25;
// Object id ("jobId") accepted from the URL. BullMQ ids are short alphanumeric
// tokens (numeric counters or custom keys). Reject anything outside this shape
// before it ever reaches Redis.
const JOB_ID_PATTERN = /^[\w.:-]{1,128}$/;

@ApiTags("Admin Queue Status")
// AdminGuard covers the whole controller. ThrottlerGuard is applied per-method
// on the mutating actions only — the GET reads are polled every few seconds by
// the dashboard, so a controller-wide limit would 429 normal usage.
@UseGuards(AdminGuard)
@ApiBearerAuth()
// NOTE: path is intentionally NOT under "admin/..." — the api-gateway guards
// "/admin/*" with a JWT *bearer* admin token, whereas the admin dashboard
// authenticates with the cookie session + x-admin-token. Living under
// "admin-dashboard/..." routes through the same gateway path as the working
// admin-dashboard endpoints and reaches mark-api's AdminGuard.
@Controller({ path: "admin-dashboard/queue-status", version: "1" })
export class QueueStatusController {
  private readonly logger = new Logger(QueueStatusController.name);

  constructor(private readonly queueStatusService: QueueStatusService) {}

  @Get()
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @ApiOperation({ summary: "Live queue counts + worker pod health" })
  async getStatus(): Promise<{
    generatedAt: string;
    queues: QueueStatDto[];
    workers: WorkerDto[];
  }> {
    const [queues, workers] = await Promise.all([
      this.queueStatusService.getQueueStats(),
      this.queueStatusService.getWorkers(),
    ]);
    this.logger.log(
      `queue-status read: ${queues.length} queues, ${workers.length} workers`,
    );
    return { generatedAt: new Date().toISOString(), queues, workers };
  }

  @Get("redis-health")
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @ApiOperation({ summary: "Redis health + worker-connection reconciliation" })
  async getRedisHealth(): Promise<RedisHealthDto> {
    const health = await this.queueStatusService.getRedisHealth();
    this.logger.log(
      `queue-status redis-health read: reconciled=${String(health.reconciled)} ` +
        `pods=${health.heartbeatPods} connections=${health.workerConnections}`,
    );
    return health;
  }

  @Get(":queueName/failed")
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @ApiOperation({ summary: "Recent failed jobs for one queue" })
  async getFailed(
    @Param("queueName") queueName: string,
    @Query("limit") limit?: string,
  ): Promise<{ queueName: string; failed: FailedJobDto[] }> {
    const requested = this.parseLimit(limit, DEFAULT_FAILED_LIMIT);
    const failed = await this.queueStatusService.getFailedJobs(
      queueName,
      requested,
    );
    this.logger.log(
      `queue-status failed read: queue=${queueName} returned=${failed.length}`,
    );
    return { queueName, failed };
  }

  @Get(":queueName/active")
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @ApiOperation({ summary: "In-flight (active) jobs for one queue" })
  async getActive(
    @Param("queueName") queueName: string,
    @Query("limit") limit?: string,
  ): Promise<{ queueName: string; active: ActiveJobDto[] }> {
    const requested = this.parseLimit(limit, DEFAULT_ACTIVE_LIMIT);
    const active = await this.queueStatusService.getActiveJobs(
      queueName,
      requested,
    );
    this.logger.log(
      `queue-status active read: queue=${queueName} returned=${active.length}`,
    );
    return { queueName, active };
  }

  @Post(":queueName/jobs/:jobId/retry")
  // Admin-only is enforced by AdminGuard (it rejects non-admin sessions). No
  // @Roles here: the global RolesGlobalGuard runs before AdminGuard, and this
  // POST path has no UserSessionMiddleware session, so @Roles would 403 every
  // caller (no session) before AdminGuard can authorize a real admin.
  // Mutating + cost-bearing: rate-limit per the admin auth flow's strict tier.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: "Retry a single failed job (ADMIN only)" })
  async retryJob(
    @Param("queueName") queueName: string,
    @Param("jobId") jobId: string,
    @Req() request: UserSessionRequest,
  ): Promise<{ ok: true }> {
    this.assertValidQueueAndJobId(queueName, jobId);
    const adminEmail = request.userSession?.userId ?? "unknown";

    const retried = await this.queueStatusService.retryFailedJob(
      queueName,
      jobId,
    );
    // Audit: admin email + action + queue + jobId only. No payload/filename.
    this.logger.log(
      `queue-action retry: admin=${adminEmail} queue=${queueName} job=${jobId} ` +
        `result=${retried ? "retried" : "refused"}`,
    );
    if (!retried) {
      // Job is missing or not in the failed state. Generic refusal — do not
      // disclose which it was.
      throw new NotFoundException("Job not available for retry");
    }
    return { ok: true };
  }

  @Delete(":queueName/jobs/:jobId")
  // Admin-only via AdminGuard (see retry above); no @Roles on this DELETE path.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: "Remove a single failed job (ADMIN only)" })
  async removeJob(
    @Param("queueName") queueName: string,
    @Param("jobId") jobId: string,
    @Req() request: UserSessionRequest,
  ): Promise<{ ok: true }> {
    this.assertValidQueueAndJobId(queueName, jobId);
    const adminEmail = request.userSession?.userId ?? "unknown";

    const removed = await this.queueStatusService.removeFailedJob(
      queueName,
      jobId,
    );
    this.logger.log(
      `queue-action remove: admin=${adminEmail} queue=${queueName} job=${jobId} ` +
        `result=${removed ? "removed" : "refused"}`,
    );
    if (!removed) {
      throw new NotFoundException("Job not available for removal");
    }
    return { ok: true };
  }

  private parseLimit(limit: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(limit ?? "", 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private assertValidQueueAndJobId(queueName: string, jobId: string): void {
    if (!(Object.values(JOB_QUEUE_NAMES) as string[]).includes(queueName)) {
      // Generic — never echo the offending value.
      throw new NotFoundException("Unknown queue");
    }
    if (typeof jobId !== "string" || !JOB_ID_PATTERN.test(jobId)) {
      throw new NotFoundException("Unknown job");
    }
  }
}
