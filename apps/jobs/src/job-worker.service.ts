import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Job, Worker } from "bullmq";
import IORedis from "ioredis";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import {
  JOB_NAMES,
  JOB_QUEUE_NAMES,
  JobName,
  JobQueueName,
} from "./job-queue.constants";
import {
  DEFAULT_JOB_WORKER_HEARTBEAT_INTERVAL_MS,
  DEFAULT_JOB_WORKER_HEARTBEAT_TTL_SECONDS,
  JOB_WORKER_HEARTBEAT_KEY_PREFIX,
} from "./job-worker-heartbeat.constants";
import { decryptJobPayload, getJobQueueSecret } from "./job-payload.crypto";
import { createRedisConnection } from "./redis.connection";

const JOB_EXECUTOR_PATH = "/api/internal/jobs/execute";

interface MarkApiJobExecutionRequest {
  queueName: JobQueueName;
  jobName: JobName;
  payload: unknown;
  bullJobId?: string;
}

@Injectable()
export class JobWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobWorkerService.name);
  private connection?: IORedis;
  private readonly workers: Worker[] = [];
  private heartbeatInterval?: NodeJS.Timeout;
  private readonly workerInstanceId = randomUUID();
  private readonly startedAt = new Date().toISOString();

  async onModuleInit(): Promise<void> {
    this.connection = createRedisConnection();

    this.workers.push(
      this.createWorker(
        JOB_QUEUE_NAMES.ASSIGNMENT_V1,
        async (job) => this.handleAssignmentV1Job(job),
        2,
      ),
      this.createWorker(
        JOB_QUEUE_NAMES.ASSIGNMENT_V2,
        async (job) => this.handleAssignmentV2Job(job),
        2,
      ),
      this.createWorker(
        JOB_QUEUE_NAMES.ATTEMPT,
        async (job) => this.handleAttemptJob(job),
        Number.parseInt(process.env.GRADING_CONCURRENCY ?? "4", 10),
      ),
      this.createWorker(
        JOB_QUEUE_NAMES.ADMIN_TRANSLATION,
        async (job) => this.handleAdminTranslationJob(job),
        1,
      ),
    );

    await Promise.all(
      this.workers.map(async (worker) => worker.waitUntilReady()),
    );
    await this.writeHeartbeat();
    this.startHeartbeat();
    this.logger.log(`Started ${this.workers.length} background job workers`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    await Promise.all(this.workers.map(async (worker) => worker.close()));
    if (this.connection) {
      await this.connection.del(this.getHeartbeatKey()).catch(() => null);
      await this.connection.quit();
    }
  }

  private createWorker(
    queueName: string,
    processor: (job: Job) => Promise<void>,
    concurrency: number,
  ): Worker {
    const worker = new Worker(queueName, processor, {
      connection: this.getConnection(),
      concurrency,
    });

    worker.on("completed", (job) => {
      this.logger.log(`Completed ${job.name}#${job.id}`);
    });

    worker.on("failed", (job, error) => {
      this.logger.error(
        `Failed ${job?.name ?? "unknown"}#${job?.id ?? "unknown"}: ${error.message}`,
        error.stack,
      );
    });

    return worker;
  }

  private getConnection(): IORedis {
    if (!this.connection) {
      this.connection = createRedisConnection();
    }

    return this.connection;
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      void this.writeHeartbeat().catch((error: Error) => {
        this.logger.warn(
          `Failed to write jobs worker heartbeat: ${error.message}`,
        );
      });
    }, this.getHeartbeatIntervalMs());
  }

  private async writeHeartbeat(): Promise<void> {
    await this.getConnection().set(
      this.getHeartbeatKey(),
      JSON.stringify({
        instanceId: this.workerInstanceId,
        hostname: hostname(),
        pid: process.pid,
        startedAt: this.startedAt,
        updatedAt: new Date().toISOString(),
        workerCount: this.workers.length,
        queues: Object.values(JOB_QUEUE_NAMES),
      }),
      "EX",
      this.getHeartbeatTtlSeconds(),
    );
  }

  private getHeartbeatKey(): string {
    return `${JOB_WORKER_HEARTBEAT_KEY_PREFIX}:${this.workerInstanceId}`;
  }

  private getHeartbeatIntervalMs(): number {
    const parsedInterval = Number.parseInt(
      process.env.JOB_WORKER_HEARTBEAT_INTERVAL_MS ?? "",
      10,
    );
    return Number.isFinite(parsedInterval) && parsedInterval > 0
      ? parsedInterval
      : DEFAULT_JOB_WORKER_HEARTBEAT_INTERVAL_MS;
  }

  private getHeartbeatTtlSeconds(): number {
    const parsedTtl = Number.parseInt(
      process.env.JOB_WORKER_HEARTBEAT_TTL_SECONDS ?? "",
      10,
    );
    return Number.isFinite(parsedTtl) && parsedTtl > 0
      ? parsedTtl
      : DEFAULT_JOB_WORKER_HEARTBEAT_TTL_SECONDS;
  }

  private async handleAssignmentV1Job(job: Job): Promise<void> {
    switch (job.name) {
      case JOB_NAMES.ASSIGNMENT_V1_GENERATE_QUESTIONS:
      case JOB_NAMES.ASSIGNMENT_V1_PUBLISH: {
        await this.forwardJobToApi(JOB_QUEUE_NAMES.ASSIGNMENT_V1, job);
        return;
      }
      default: {
        throw new Error(`Unsupported assignment v1 job: ${job.name}`);
      }
    }
  }

  private async handleAssignmentV2Job(job: Job): Promise<void> {
    switch (job.name) {
      case JOB_NAMES.ASSIGNMENT_V2_GENERATE_QUESTIONS:
      case JOB_NAMES.ASSIGNMENT_V2_PUBLISH: {
        await this.forwardJobToApi(JOB_QUEUE_NAMES.ASSIGNMENT_V2, job);
        return;
      }
      default: {
        throw new Error(`Unsupported assignment v2 job: ${job.name}`);
      }
    }
  }

  private async handleAttemptJob(job: Job): Promise<void> {
    switch (job.name) {
      case JOB_NAMES.ATTEMPT_GRADE:
      case JOB_NAMES.ATTEMPT_AUTHOR_PREVIEW: {
        await this.forwardJobToApi(JOB_QUEUE_NAMES.ATTEMPT, job);
        return;
      }
      default: {
        throw new Error(`Unsupported attempt job: ${job.name}`);
      }
    }
  }

  private async handleAdminTranslationJob(job: Job): Promise<void> {
    switch (job.name) {
      case JOB_NAMES.ADMIN_FIX_MISSING_TRANSLATIONS:
      case JOB_NAMES.ADMIN_SWEEP_MISSING_TRANSLATIONS: {
        await this.forwardJobToApi(JOB_QUEUE_NAMES.ADMIN_TRANSLATION, job);
        return;
      }
      default: {
        throw new Error(`Unsupported admin translation job: ${job.name}`);
      }
    }
  }

  private getDecryptedJobData<T>(job: Job): T {
    return decryptJobPayload<T>(job.data);
  }

  private async forwardJobToApi(
    queueName: JobQueueName,
    job: Job,
  ): Promise<void> {
    const request: MarkApiJobExecutionRequest = {
      queueName,
      jobName: job.name as JobName,
      payload: this.getDecryptedJobData<unknown>(job),
      bullJobId: job.id,
    };
    const response = await fetch(this.getJobExecutorUrl(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-job-queue-secret": getJobQueueSecret(),
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const responseBody = await response.text().catch(() => "");
      const details = responseBody ? ` - ${responseBody}` : "";
      throw new Error(
        `Mark API job execution failed for ${job.name}#${job.id ?? "unknown"}: ${response.status} ${response.statusText}${details}`,
      );
    }
  }

  private getJobExecutorUrl(): string {
    if (process.env.MARK_API_JOB_EXECUTOR_URL) {
      return process.env.MARK_API_JOB_EXECUTOR_URL;
    }

    const baseUrl =
      process.env.MARK_API_ENDPOINT ??
      process.env.MARK_API_URL ??
      `http://localhost:${process.env.API_PORT ?? "4222"}`;
    return `${baseUrl.replace(/\/+$/, "")}${JOB_EXECUTOR_PATH}`;
  }
}
