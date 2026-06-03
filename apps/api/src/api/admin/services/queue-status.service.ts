import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { pickDomainIds } from "../../../job-queue/job-domain-ids";
import { JOB_QUEUE_NAMES } from "../../../job-queue/job-queue.constants";
import { decryptJobPayload } from "../../../job-queue/job-payload.crypto";
import { JobQueueService } from "../../../job-queue/job-queue.service";
import { JobWorkerConnectionService } from "../../../job-queue/job-worker-connection.service";

const HEARTBEAT_STALE_AFTER_MS = 20_000;
const FAILED_JOBS_MAX = 100;
const FAILED_JOBS_DEFAULT = 25;
const FAILED_REASON_MAX_CHARS = 2000;

export interface QueueStatDto {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  paused: number;
  unavailable?: boolean;
}

export interface WorkerDto {
  instanceId: string;
  hostname: string;
  pid: number;
  startedAt: string | null;
  updatedAt: string | null;
  uptimeMs: number | null;
  lastSeenMs: number | null;
  stale: boolean;
  workerCount: number;
  queues: string[];
}

export interface FailedJobDto {
  id: string;
  name: string;
  attemptsMade: number;
  maxAttempts: number;
  failedReason: string;
  failedAt: string | null;
  domainIds: Record<string, number | string>;
}

@Injectable()
export class QueueStatusService {
  private readonly logger = new Logger(QueueStatusService.name);

  constructor(
    private readonly jobQueueService: JobQueueService,
    private readonly workerConnectionService: JobWorkerConnectionService,
  ) {}

  async getQueueStats(): Promise<QueueStatDto[]> {
    const names = Object.values(JOB_QUEUE_NAMES);
    return Promise.all(
      names.map(async (name): Promise<QueueStatDto> => {
        try {
          const counts = await this.jobQueueService.getQueueCounts(name);
          return { name, ...counts };
        } catch (error: unknown) {
          // One queue's Redis hiccup must not fail the whole dashboard.
          this.logger.warn(
            `Queue counts unavailable for ${name}: ${this.messageOf(error)}`,
          );
          return {
            name,
            waiting: 0,
            active: 0,
            delayed: 0,
            failed: 0,
            completed: 0,
            paused: 0,
            unavailable: true,
          };
        }
      }),
    );
  }

  async getWorkers(): Promise<WorkerDto[]> {
    const heartbeats =
      await this.workerConnectionService.getAllWorkerHeartbeats();
    const now = Date.now();
    return heartbeats.map((hb): WorkerDto => {
      const startedAt = typeof hb.startedAt === "string" ? hb.startedAt : null;
      const updatedAt = typeof hb.updatedAt === "string" ? hb.updatedAt : null;
      const lastSeenMs = updatedAt ? now - Date.parse(updatedAt) : null;
      return {
        instanceId: hb.instanceId ?? "unknown",
        hostname: hb.hostname ?? "unknown",
        pid: hb.pid ?? 0,
        startedAt,
        updatedAt,
        uptimeMs: startedAt ? now - Date.parse(startedAt) : null,
        lastSeenMs,
        stale: lastSeenMs === null || lastSeenMs > HEARTBEAT_STALE_AFTER_MS,
        workerCount: hb.workerCount ?? 0,
        queues: Array.isArray(hb.queues) ? hb.queues : [],
      };
    });
  }

  async getFailedJobs(
    queueName: string,
    requestedLimit: number,
  ): Promise<FailedJobDto[]> {
    if (!(Object.values(JOB_QUEUE_NAMES) as string[]).includes(queueName)) {
      // Generic error — do not echo the offending value or hint at internals.
      throw new NotFoundException("Unknown queue");
    }
    const limit = this.clampLimit(requestedLimit);
    const jobs = await this.jobQueueService.getFailedJobs(queueName, limit);
    return jobs.map((job) => ({
      id: String(job.id ?? "unknown"),
      name: job.name,
      attemptsMade: job.attemptsMade ?? 0,
      maxAttempts: job.opts?.attempts ?? 1,
      failedReason: (job.failedReason ?? "").slice(0, FAILED_REASON_MAX_CHARS),
      failedAt:
        typeof job.finishedOn === "number"
          ? new Date(job.finishedOn).toISOString()
          : null,
      domainIds: this.extractDomainIds(job.data, job),
    }));
  }

  private clampLimit(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return FAILED_JOBS_DEFAULT;
    return Math.min(Math.floor(value), FAILED_JOBS_MAX);
  }

  private extractDomainIds(
    data: unknown,
    job: { id?: string | number; name?: string },
  ): Record<string, number | string> {
    let payload: Record<string, unknown>;
    try {
      payload = decryptJobPayload<Record<string, unknown>>(data);
    } catch (error: unknown) {
      // Drill-down must not fail because one payload can't be read.
      this.logger.warn(
        `Failed-job domain-id decrypt failed for ${job.name ?? "?"}#${
          job.id ?? "?"
        }: ${this.messageOf(error)}`,
      );
      return {};
    }
    return pickDomainIds(payload);
  }

  private messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
