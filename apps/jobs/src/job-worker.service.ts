import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Job, Worker } from "bullmq";
import IORedis from "ioredis";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { Agent as UndiciAgent } from "undici";
import { Logger as WinstonLogger } from "winston";
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
import { JobExecutorService } from "../../api/src/job-queue/job-executor.service";

// Allowed-fields-only shape carried in translation-job payloads. Restricted
// to identifiers; the LLM-produced translatedText/translatedChoices that
// the executor side handles never appear in the worker's view of the
// payload, and never appear in the structured logs below.
interface TranslationJobPayload {
  assignmentId: number;
  questionId?: number;
  variantId?: number;
  parentJobId?: string;
}

const JOB_EXECUTOR_PATH = "/api/internal/jobs/execute";

// Explicit fetch timeout on the worker→api forward path. Must exceed
// PUBLISH_TRANSLATION_POLL_TIMEOUT_MS (30 min on mark-api) plus the
// DB-writes overhead before the poll loop starts; otherwise the worker
// aborts the connection before mark-api's runPublishJob terminates,
// BullMQ marks the publish failed under attempts: 1 / removeOnFail: true,
// the deterministic publish:v2:${assignmentId} dedup entry disappears,
// and the user's next click enqueues a second publish that races the
// still-running first on the per-publish status hash and the version
// activate transaction. 35 minutes leaves a 5-minute headroom for the
// DB-writes phase. Without an explicit signal, Node's undici fetch
// enforces its default bodyTimeout=300_000ms (5 minutes), far shorter
// than any of this.
const JOB_FORWARD_TIMEOUT_MS = 35 * 60 * 1000;

// AbortSignal.timeout above caps wall-clock duration but does NOT override
// undici's bodyTimeout / headersTimeout (both default 300_000ms = 5 min).
// A parent publish forward holds the connection open while mark-api's poll
// loop waits on translation children — no body bytes flow during that
// window, so undici's bodyTimeout fires at 5 min, mark-api logs
// `client_disconnected after 300519ms`, and the parent BullMQ job is
// reported failed. A custom Agent with extended bodyTimeout + headersTimeout
// is the only documented way to override these on Node's global fetch.
const longLivedForwardDispatcher = new UndiciAgent({
  bodyTimeout: JOB_FORWARD_TIMEOUT_MS,
  headersTimeout: JOB_FORWARD_TIMEOUT_MS,
});

interface MarkApiJobExecutionRequest {
  queueName: JobQueueName;
  jobName: JobName;
  payload: unknown;
  bullJobId?: string;
  attemptsMade?: number;
  maxAttempts?: number;
}

@Injectable()
export class JobWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobWorkerService.name);
  // Winston logger sits alongside the Nest Logger because the structured
  // job-lifecycle log lines below take an object payload as the second
  // argument; Nest's Logger.log() does not. The Nest Logger keeps emitting
  // the existing string-style lifecycle lines through the same Winston
  // bootstrap configured in main.ts, so transports/format stay consistent.
  private readonly structuredLogger: WinstonLogger;
  private connection?: IORedis;
  private readonly workers: Worker[] = [];
  private heartbeatInterval?: NodeJS.Timeout;
  private readonly workerInstanceId = randomUUID();
  private readonly startedAt = new Date().toISOString();

  constructor(
    private readonly jobExecutorService: JobExecutorService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: WinstonLogger,
  ) {
    this.structuredLogger = parentLogger.child({
      context: JobWorkerService.name,
    });
  }

  // Single source of truth for the JOBS_EXECUTE_LOCALLY flag check.
  // Strict equality preserves default-OFF for undefined, "", "false", "True".
  private shouldExecuteLocally(): boolean {
    return process.env.JOBS_EXECUTE_LOCALLY === "true";
  }

  async onModuleInit(): Promise<void> {
    this.connection = createRedisConnection();

    // Assignment publish jobs run inline translation that can take >5 minutes,
    // sometimes longer for large imports. BullMQ's default lockDuration of 30s
    // would let the worker miss heartbeat extensions during long publishes,
    // causing the broker to mark the job stalled and spawn a recovery execution
    // that races the original (both workers running the same jobId, fighting
    // over markAsDeleted on the same question set). The lock auto-renews every
    // lockDuration / 2 ms via an internal Worker timer, so this value is the
    // failure-detection threshold (how long renewal can fail before the job is
    // considered stalled), not the max publish duration.
    //
    // The API-side publish poll loop caps execution at 30 minutes
    // (PUBLISH_TRANSLATION_POLL_TIMEOUT_MS). The lock TTL must outlive that
    // ceiling so a worker finishing right at the 30-min boundary cannot be
    // marked stalled by a renewal that hasn't fired yet. 31.5 minutes
    // (1_890_000) gives a 90s safety margin past the worst-case poll exit.
    // maxStalledCount=0 means a genuinely-stalled worker fails the job
    // permanently rather than spawning a concurrent retry.
    const ASSIGNMENT_PUBLISH_LOCK_DURATION_MS = 1_890_000;
    const ASSIGNMENT_NO_STALL_RECOVERY = 0;

    // 120-second lockDuration + maxStalledCount=0 prevents BullMQ stall-recovery
    // from racing the original execution. A single translation job fans out 23
    // languages across TRANSLATION_CONCURRENCY=8 in-process slots, so realistic
    // wall-clock is 5-10s typical, ~30-60s pathological under provider throttling
    // or Bottleneck saturation. 120s leaves ~2x headroom over the worst observed
    // and surfaces a dead worker quickly (the lock controls failure-detection
    // latency, not max execution time). maxStalledCount=0 means a genuinely-
    // stalled worker fails permanently rather than spawning a recovery execution
    // that would race writes to the same Translation rows.
    const TRANSLATION_LOCK_DURATION_MS = 120_000;
    const TRANSLATION_NO_STALL_RECOVERY = 0;

    this.workers.push(
      this.createWorker(
        JOB_QUEUE_NAMES.ASSIGNMENT_V1,
        async (job) => this.handleAssignmentV1Job(job),
        2,
        {
          lockDuration: ASSIGNMENT_PUBLISH_LOCK_DURATION_MS,
          maxStalledCount: ASSIGNMENT_NO_STALL_RECOVERY,
        },
      ),
      this.createWorker(
        JOB_QUEUE_NAMES.ASSIGNMENT_V2,
        async (job) => this.handleAssignmentV2Job(job),
        2,
        {
          lockDuration: ASSIGNMENT_PUBLISH_LOCK_DURATION_MS,
          maxStalledCount: ASSIGNMENT_NO_STALL_RECOVERY,
        },
      ),
      this.createWorker(
        JOB_QUEUE_NAMES.ASSIGNMENT_V2_TRANSLATIONS,
        async (job) => this.handleTranslationJob(job),
        Number.parseInt(process.env.TRANSLATION_CONCURRENCY ?? "8", 10),
        {
          lockDuration: TRANSLATION_LOCK_DURATION_MS,
          maxStalledCount: TRANSLATION_NO_STALL_RECOVERY,
        },
      ),
      this.createWorker(
        JOB_QUEUE_NAMES.ATTEMPT,
        async (job) => this.handleAttemptJob(job),
        // Number of grading JOBS the worker pulls from BullMQ concurrently.
        // Distinct from GRADING_CONCURRENCY (apps/api), which caps how many
        // LLM CALLS run in parallel inside one grading job. The two values
        // were sharing a name and produced a footgun where setting one
        // accidentally tuned the other; renamed to make the layer explicit.
        Number.parseInt(process.env.GRADING_WORKER_CONCURRENCY ?? "4", 10),
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
    options: { lockDuration?: number; maxStalledCount?: number } = {},
  ): Worker {
    const worker = new Worker(queueName, processor, {
      connection: this.getConnection(),
      concurrency,
      ...(options.lockDuration !== undefined && {
        lockDuration: options.lockDuration,
      }),
      ...(options.maxStalledCount !== undefined && {
        maxStalledCount: options.maxStalledCount,
      }),
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
      case JOB_NAMES.ASSIGNMENT_V1_GENERATE_QUESTIONS: {
        if (this.shouldExecuteLocally()) {
          this.logger.debug(
            `Routing locally: queue=${JOB_QUEUE_NAMES.ASSIGNMENT_V1} jobName=${job.name} jobId=${job.id}`,
          );
          await this.jobExecutorService.executeJob({
            queueName: JOB_QUEUE_NAMES.ASSIGNMENT_V1,
            jobName: job.name as JobName,
            payload: this.getDecryptedJobData(job),
            bullJobId: job.id,
          });
        } else {
          this.logger.debug(
            `Forwarding to API: queue=${JOB_QUEUE_NAMES.ASSIGNMENT_V1} jobName=${job.name} jobId=${job.id}`,
          );
          await this.forwardJobToApi(JOB_QUEUE_NAMES.ASSIGNMENT_V1, job);
        }
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
      case JOB_NAMES.ASSIGNMENT_V2_PUBLISH:
      case JOB_NAMES.ASSIGNMENT_V2_RETRY_FAILED_TRANSLATIONS: {
        if (this.shouldExecuteLocally()) {
          this.logger.debug(
            `Routing locally: queue=${JOB_QUEUE_NAMES.ASSIGNMENT_V2} jobName=${job.name} jobId=${job.id}`,
          );
          await this.jobExecutorService.executeJob({
            queueName: JOB_QUEUE_NAMES.ASSIGNMENT_V2,
            jobName: job.name as JobName,
            payload: this.getDecryptedJobData(job),
            bullJobId: job.id,
          });
        } else {
          this.logger.debug(
            `Forwarding to API: queue=${JOB_QUEUE_NAMES.ASSIGNMENT_V2} jobName=${job.name} jobId=${job.id}`,
          );
          await this.forwardJobToApi(JOB_QUEUE_NAMES.ASSIGNMENT_V2, job);
        }
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
        if (this.shouldExecuteLocally()) {
          this.logger.debug(
            `Routing locally: queue=${JOB_QUEUE_NAMES.ATTEMPT} jobName=${job.name} jobId=${job.id}`,
          );
          await this.jobExecutorService.executeJob({
            queueName: JOB_QUEUE_NAMES.ATTEMPT,
            jobName: job.name as JobName,
            payload: this.getDecryptedJobData(job),
            bullJobId: job.id,
          });
        } else {
          this.logger.debug(
            `Forwarding to API: queue=${JOB_QUEUE_NAMES.ATTEMPT} jobName=${job.name} jobId=${job.id}`,
          );
          await this.forwardJobToApi(JOB_QUEUE_NAMES.ATTEMPT, job);
        }
        return;
      }
      default: {
        throw new Error(`Unsupported attempt job: ${job.name}`);
      }
    }
  }

  // Routes translation jobs (question / variant / assignment-meta) through the
  // same local/forward branch all other handlers use. All three job names
  // share identical routing semantics so they collapse into one switch case.
  // Structured Winston log lines emit at start/complete/failed boundaries
  // with IDs and counts only -- translatedText/translatedChoices/raw error
  // objects are intentionally absent from the JSON payloads.
  private async handleTranslationJob(job: Job): Promise<void> {
    const startTime = Date.now();
    const payload = this.getDecryptedJobData<TranslationJobPayload>(job);
    const id = payload.questionId ?? payload.variantId ?? payload.assignmentId;

    this.structuredLogger.info("publish.translation.job.start", {
      assignmentId: payload.assignmentId,
      kind: this.kindFromJobName(job.name),
      id,
      jobId: job.id,
      jobName: job.name,
      languageCount: 23,
    });

    try {
      switch (job.name) {
        case JOB_NAMES.TRANSLATE_QUESTION:
        case JOB_NAMES.TRANSLATE_VARIANT:
        case JOB_NAMES.TRANSLATE_META: {
          if (this.shouldExecuteLocally()) {
            this.logger.debug(
              `Routing locally: queue=${JOB_QUEUE_NAMES.ASSIGNMENT_V2_TRANSLATIONS} jobName=${job.name} jobId=${job.id}`,
            );
            await this.jobExecutorService.executeJob({
              queueName: JOB_QUEUE_NAMES.ASSIGNMENT_V2_TRANSLATIONS,
              jobName: job.name as JobName,
              payload,
              bullJobId: job.id,
              ...this.getAttemptMetadata(job),
            });
          } else {
            this.logger.debug(
              `Forwarding to API: queue=${JOB_QUEUE_NAMES.ASSIGNMENT_V2_TRANSLATIONS} jobName=${job.name} jobId=${job.id}`,
            );
            await this.forwardJobToApi(
              JOB_QUEUE_NAMES.ASSIGNMENT_V2_TRANSLATIONS,
              job,
            );
          }
          break;
        }
        default: {
          throw new Error(`Unsupported translation job: ${job.name}`);
        }
      }

      // Worker-side complete log carries durationMs only. Per-language
      // success/failure counts come from the executor side, which emits its
      // own complete log line with the per-language counters captured from
      // TranslationService's internal allSettled fan-out.
      this.structuredLogger.info("publish.translation.job.complete", {
        assignmentId: payload.assignmentId,
        kind: this.kindFromJobName(job.name),
        id,
        jobId: job.id,
        durationMs: Date.now() - startTime,
      });
    } catch (error: unknown) {
      // error.message only -- never the raw error object or error.stack in
      // the JSON payload. The Nest Logger's "failed" lifecycle hook on the
      // Worker captures the stack to its separate winston debug transport.
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.structuredLogger.error("publish.translation.job.failed", {
        assignmentId: payload.assignmentId,
        kind: this.kindFromJobName(job.name),
        id,
        jobId: job.id,
        error: errorMessage,
      });
      // Rethrow so BullMQ's retry policy (set by the producer with attempts
      // and exponential backoff) sees the failure and schedules a retry.
      throw error;
    }
  }

  private kindFromJobName(jobName: string): "question" | "variant" | "meta" {
    if (jobName === JOB_NAMES.TRANSLATE_QUESTION) return "question";
    if (jobName === JOB_NAMES.TRANSLATE_VARIANT) return "variant";
    return "meta";
  }

  private async handleAdminTranslationJob(job: Job): Promise<void> {
    switch (job.name) {
      case JOB_NAMES.ADMIN_FIX_MISSING_TRANSLATIONS:
      case JOB_NAMES.ADMIN_SWEEP_MISSING_TRANSLATIONS: {
        if (this.shouldExecuteLocally()) {
          this.logger.debug(
            `Routing locally: queue=${JOB_QUEUE_NAMES.ADMIN_TRANSLATION} jobName=${job.name} jobId=${job.id}`,
          );
          await this.jobExecutorService.executeJob({
            queueName: JOB_QUEUE_NAMES.ADMIN_TRANSLATION,
            jobName: job.name as JobName,
            payload: this.getDecryptedJobData(job),
            bullJobId: job.id,
          });
        } else {
          this.logger.debug(
            `Forwarding to API: queue=${JOB_QUEUE_NAMES.ADMIN_TRANSLATION} jobName=${job.name} jobId=${job.id}`,
          );
          await this.forwardJobToApi(JOB_QUEUE_NAMES.ADMIN_TRANSLATION, job);
        }
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

  private getAttemptMetadata(job: Job): {
    attemptsMade: number;
    maxAttempts: number;
  } {
    const maxAttempts = job.opts?.attempts;
    return {
      attemptsMade: Number.isFinite(job.attemptsMade) ? job.attemptsMade : 0,
      maxAttempts:
        typeof maxAttempts === "number" && maxAttempts > 0 ? maxAttempts : 1,
    };
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
      ...(queueName === JOB_QUEUE_NAMES.ASSIGNMENT_V2_TRANSLATIONS
        ? this.getAttemptMetadata(job)
        : {}),
    };
    const response = await fetch(this.getJobExecutorUrl(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-job-queue-secret": getJobQueueSecret(),
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(JOB_FORWARD_TIMEOUT_MS),
      // Non-standard fetch option, passed through to undici. Required
      // alongside the AbortSignal — see comment on longLivedForwardDispatcher.
      dispatcher: longLivedForwardDispatcher,
    } as RequestInit & { dispatcher: UndiciAgent });

    if (!response.ok) {
      const responseBody = await response.text().catch(() => "");
      const details = responseBody ? ` - ${responseBody}` : "";
      throw new Error(
        `Mark API job execution failed for ${job.name}#${job.id ?? "unknown"}: ${response.status} ${response.statusText}${details}`,
      );
    }
  }

  private getJobExecutorUrl(): string {
    const raw =
      process.env.MARK_API_JOB_EXECUTOR_URL ||
      `${(
        process.env.MARK_API_ENDPOINT ??
        process.env.MARK_API_URL ??
        `http://localhost:${process.env.API_PORT ?? "4222"}`
      ).replace(/\/+$/, "")}${JOB_EXECUTOR_PATH}`;

    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid job executor URL "${raw}": ${message}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(
        `Invalid job executor URL "${raw}": unsupported scheme "${parsed.protocol}"`,
      );
    }
    return raw;
  }
}
