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
import { UserSessionRequest } from "src/auth/interfaces/user.session.interface";
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
// AdminGuard covers the whole controller and is the single source of truth for
// access: it rejects any session that is not an admin, so every current and
// future route here is admin-gated by default — no per-route @Roles is needed
// or wanted (a @Roles would route through RolesGlobalGuard and couple admin
// access to an author-role session being present). ThrottlerGuard is applied
// per-method on the mutating actions only — the GET reads are polled every few
// seconds by the dashboard, so a controller-wide limit would 429 normal usage.
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
  @ApiOperation({ summary: "Live queue counts + worker pod health" })
  async getStatus(): Promise<{
    generatedAt: string;
    queues: QueueStatDto[];
    workers: WorkerDto[];
  }> {
    // Scan worker heartbeats once (a Redis SCAN + per-key GET) and share the
    // result with both the queue stats and the worker rows. Each independently
    // fetched them before, doubling the scan on every poll.
    const heartbeats = await this.queueStatusService.getAllWorkerHeartbeats();
    const [queues, workers] = await Promise.all([
      this.queueStatusService.getQueueStats(heartbeats),
      this.queueStatusService.getWorkers(heartbeats),
    ]);
    this.logger.log(
      `queue-status read: ${queues.length} queues, ${workers.length} workers`,
    );
    return { generatedAt: new Date().toISOString(), queues, workers };
  }

  @Get("redis-health")
  @ApiOperation({ summary: "Redis health + worker-connection reconciliation" })
  async getRedisHealth(): Promise<RedisHealthDto> {
    const health = await this.queueStatusService.getRedisHealth();
    this.logger.log(
      `queue-status redis-health read: reconciled=${String(health.reconciled)} ` +
        `pods=${health.heartbeatPods} connections=${health.workerConnections}`,
    );
    return health;
  }

  @Get("failed")
  @ApiOperation({ summary: "Recent failed jobs for one queue" })
  async getFailed(
    @Query("queue") queueName: string,
    @Query("limit") limit?: string,
  ): Promise<{ queueName: string; failed: FailedJobDto[] }> {
    this.assertKnownQueue(queueName);
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

  @Get("active")
  @ApiOperation({ summary: "In-flight (active) jobs for one queue" })
  async getActive(
    @Query("queue") queueName: string,
    @Query("limit") limit?: string,
  ): Promise<{ queueName: string; active: ActiveJobDto[] }> {
    this.assertKnownQueue(queueName);
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

  @Post("jobs/:jobId/retry")
  // Admin-only is enforced by the class-level AdminGuard (it rejects non-admin
  // sessions). Mutating + cost-bearing: rate-limit per the admin auth flow's
  // strict tier.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: "Retry a single failed job (ADMIN only)" })
  async retryJob(
    @Query("queue") queueName: string,
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

  @Delete("jobs/:jobId")
  // Admin-only via the class-level AdminGuard (see retry above).
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: "Remove a single failed job (ADMIN only)" })
  async removeJob(
    @Query("queue") queueName: string,
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

  // The queue name arrives as a `?queue=` query parameter rather than a URL path
  // segment. Queue names contain dots ("mark.assignment.v2"); a dotted path
  // segment is treated as file-like by the same-origin Next.js rewrite proxy and
  // never forwards (a bare transport-level "fetch failed"). A query value carries
  // the dots opaquely and is not path-normalized, so it survives every proxy hop
  // without relying on percent-encoding being preserved. getQueue() instantiates
  // a Queue for any string, so an unrecognized name must be rejected here before
  // it ever reaches Redis.
  private assertKnownQueue(queueName: string): void {
    if (!(Object.values(JOB_QUEUE_NAMES) as string[]).includes(queueName)) {
      // Generic — never echo the offending value.
      throw new NotFoundException("Unknown queue");
    }
  }

  private assertValidQueueAndJobId(queueName: string, jobId: string): void {
    this.assertKnownQueue(queueName);
    if (typeof jobId !== "string" || !JOB_ID_PATTERN.test(jobId)) {
      throw new NotFoundException("Unknown job");
    }
  }
}
