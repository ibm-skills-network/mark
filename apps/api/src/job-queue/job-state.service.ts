import { createHash, randomUUID } from "node:crypto";
import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import IORedis from "ioredis";
import { Observable } from "rxjs";
import {
  CreateJobStateOptions,
  JobStateRecord,
  JobStatusUpdate,
} from "./job-state.types";
import { createRedisConnection } from "./redis.connection";

interface StoredJobState extends JobStateRecord {
  activeKeyHash?: string;
}

const ACTIVE_JOB_TTL_SECONDS = 24 * 60 * 60;
const TERMINAL_JOB_TTL_SECONDS = 7 * 24 * 60 * 60;
const NULL_SENTINEL = "__null__";

@Injectable()
export class JobStateService implements OnModuleDestroy {
  private readonly logger = new Logger(JobStateService.name);
  private connection?: IORedis;

  private getConnection(): IORedis {
    if (!this.connection) {
      this.connection = createRedisConnection();
    }

    return this.connection;
  }

  async createJob(options: CreateJobStateOptions): Promise<JobStateRecord> {
    const now = new Date().toISOString();
    const activeKeyHash = options.activeKey
      ? this.hashActiveKey(options.activeKey)
      : undefined;
    const job: StoredJobState = {
      id: options.reservedId ?? randomUUID(),
      queueName: options.queueName,
      jobName: options.jobName,
      kind: options.kind,
      userId: options.userId,
      assignmentId: options.assignmentId,
      attemptId: options.attemptId,
      status: options.status,
      progress: options.progress,
      percentage: this.normalizePercentage(options.percentage),
      result: options.result,
      activeKeyHash,
      createdAt: now,
      updatedAt: now,
    };

    const transaction = this.getConnection().multi();
    // DEL before HSET so a new job with a re-used deterministic id
    // (e.g. publish:v2:${assignmentId}) starts on a clean hash. Without
    // this, fields that serializeJob leaves out when undefined — most
    // importantly `result` — survive from the previous job under the
    // same key, and the SSE stream's initial emit replays a stale
    // PublishJobResult to the client as if the new publish had already
    // finished.
    transaction.del(this.getJobStateKey(job.id));
    transaction.hset(this.getJobStateKey(job.id), this.serializeJob(job));
    transaction.expire(this.getJobStateKey(job.id), ACTIVE_JOB_TTL_SECONDS);

    if (activeKeyHash && !options.reservedId) {
      // Only set the active key pointer if it wasn't already set by acquireActiveJobLock
      transaction.set(
        this.getActiveJobKey(activeKeyHash),
        job.id,
        "EX",
        ACTIVE_JOB_TTL_SECONDS,
      );
    }

    await transaction.exec();
    return this.toPublicJob(job);
  }

  /**
   * Atomically acquire an active-job lock using Redis SET NX.
   * Returns null if the lock was acquired (caller should proceed to create the job),
   * or the existing jobId if the lock was already held by another job.
   */
  async acquireActiveJobLock(
    activeKey: string,
    temporaryJobId: string,
  ): Promise<string | null> {
    const activeKeyHash = this.hashActiveKey(activeKey);
    const redisKey = this.getActiveJobKey(activeKeyHash);
    // SET key value EX ttl NX – atomic set-if-not-exists (ioredis argument order)
    const result = await this.getConnection().set(
      redisKey,
      temporaryJobId,
      "EX",
      ACTIVE_JOB_TTL_SECONDS,
      "NX",
    );
    if (result === null) {
      // Lock already held – return existing jobId
      const existingJobId = await this.getConnection().get(redisKey);
      return existingJobId;
    }
    // Lock acquired – return null to signal caller to proceed
    return null;
  }

  async findActiveJob(activeKey: string): Promise<JobStateRecord | null> {
    const activeKeyHash = this.hashActiveKey(activeKey);
    const jobId = await this.getConnection().get(
      this.getActiveJobKey(activeKeyHash),
    );
    if (!jobId) {
      return null;
    }

    const job = await this.getStoredJob(jobId);
    if (!job) {
      await this.getConnection().del(this.getActiveJobKey(activeKeyHash));
      return null;
    }

    if (!this.isActiveStatus(job.status)) {
      await this.getConnection().del(this.getActiveJobKey(activeKeyHash));
      return null;
    }

    return this.toPublicJob(job);
  }

  async getJob(jobId: string): Promise<JobStateRecord | null> {
    const job = await this.getStoredJob(jobId);
    return job ? this.toPublicJob(job) : null;
  }

  async updateJobStatus(
    jobId: string,
    statusUpdate: JobStatusUpdate,
  ): Promise<JobStateRecord> {
    const existingJob = await this.getStoredJob(jobId);
    if (!existingJob) {
      throw new Error(`Job ${jobId} not found`);
    }

    const updatedJob: StoredJobState = {
      ...existingJob,
      status: statusUpdate.status,
      progress:
        statusUpdate.progress?.slice(0, 255) ||
        existingJob.progress ||
        "Updating",
      updatedAt: new Date().toISOString(),
      percentage:
        statusUpdate.percentage === undefined
          ? existingJob.percentage
          : this.normalizePercentage(statusUpdate.percentage),
      currentQuestion:
        statusUpdate.currentQuestion ?? existingJob.currentQuestion,
      totalQuestions:
        statusUpdate.totalQuestions ?? existingJob.totalQuestions,
      result:
        statusUpdate.result === undefined
          ? existingJob.result
          : statusUpdate.result,
    };

    // Only HSET the fields the caller actually provided. The previous
    // behavior — read existingJob then HSET the whole serialized record,
    // preserving fields the caller didn't touch — was a textbook
    // read-modify-write race: when the publish poll loop wrote a fresh
    // `result` while a worker was mid-call without one, the worker's
    // write inherited the pre-poll-loop `result` and clobbered it back
    // to a stale snapshot. The hash field model means concurrent writers
    // only fight over the fields they each explicitly set.
    const partialPayload = this.serializeJobUpdate(updatedJob, statusUpdate);

    const transaction = this.getConnection().multi();
    transaction.hset(this.getJobStateKey(jobId), partialPayload);
    transaction.expire(
      this.getJobStateKey(jobId),
      this.isTerminalStatus(updatedJob.status)
        ? TERMINAL_JOB_TTL_SECONDS
        : ACTIVE_JOB_TTL_SECONDS,
    );

    if (existingJob.activeKeyHash) {
      if (this.isTerminalStatus(updatedJob.status)) {
        transaction.del(this.getActiveJobKey(existingJob.activeKeyHash));
      } else {
        transaction.set(
          this.getActiveJobKey(existingJob.activeKeyHash),
          jobId,
          "EX",
          ACTIVE_JOB_TTL_SECONDS,
        );
      }
    }

    await transaction.exec();

    const publicJob = this.toPublicJob(updatedJob);
    await this.getConnection().publish(
      this.getJobEventChannel(jobId),
      JSON.stringify(publicJob),
    );

    return publicJob;
  }

  getJobStatusStream(jobId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const subscriptionConnection = this.getConnection().duplicate();
      const jobEventChannel = this.getJobEventChannel(jobId);
      let heartbeatInterval: NodeJS.Timeout | undefined;
      let closed = false;

      const emitJob = (job: JobStateRecord) => {
        subscriber.next(this.toMessageEvent(job));

        if (this.isTerminalStatus(job.status)) {
          setTimeout(() => {
            if (!closed) {
              subscriber.complete();
            }
          }, 100);
        }
      };

      subscriptionConnection.on("message", (_channel, message) => {
        try {
          const parsedJob = JSON.parse(message) as JobStateRecord;
          emitJob(parsedJob);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          subscriber.error(
            new Error(`Invalid job event payload: ${errorMessage}`),
          );
        }
      });

      subscriptionConnection.on("error", (error) => {
        if (!closed) {
          this.logger.error(
            `Redis subscription error for job ${jobId}: ${error.message}`,
            error.stack,
          );
          subscriber.error(error);
        }
      });

      void (async () => {
        await subscriptionConnection.subscribe(jobEventChannel);
        const currentJob = await this.getJob(jobId);
        if (!currentJob) {
          subscriber.error(new Error(`Job ${jobId} not found.`));
          return;
        }

        emitJob(currentJob);

        heartbeatInterval = setInterval(() => {
          if (!closed) {
            subscriber.next({
              type: "heartbeat",
              data: JSON.stringify({
                heartbeat: true,
                jobId,
                timestamp: new Date().toISOString(),
              }),
            } as MessageEvent);
          }
        }, 10_000);
      })().catch((error: Error) => {
        subscriber.error(error);
      });

      return () => {
        closed = true;
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
        }

        void subscriptionConnection
          .unsubscribe(jobEventChannel)
          .catch((error: Error) => {
            this.logger.debug(
              `Failed to unsubscribe from ${jobEventChannel}: ${error.message}`,
            );
          });
        void subscriptionConnection.quit().catch((error: Error) => {
          this.logger.debug(
            `Failed to close subscription for ${jobEventChannel}: ${error.message}`,
          );
        });
      };
    });
  }

  async cleanupJobStream(_jobId: string): Promise<void> {
    void _jobId;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.connection) {
      await this.connection.quit();
    }
  }

  private async getStoredJob(jobId: string): Promise<StoredJobState | null> {
    const rawJob = await this.getConnection().hgetall(
      this.getJobStateKey(jobId),
    );
    if (Object.keys(rawJob).length === 0) {
      return null;
    }

    return this.deserializeJob(rawJob);
  }

  private getJobStateKey(jobId: string): string {
    return `mark:jobs:state:${jobId}`;
  }

  private getJobEventChannel(jobId: string): string {
    return `mark:jobs:events:${jobId}`;
  }

  private getActiveJobKey(activeKeyHash: string): string {
    return `mark:jobs:active:${activeKeyHash}`;
  }

  private hashActiveKey(activeKey: string): string {
    return createHash("sha256").update(activeKey).digest("hex");
  }

  private serializeJob(job: StoredJobState): Record<string, string> {
    const payload: Record<string, string> = {
      id: job.id,
      queueName: job.queueName,
      jobName: job.jobName,
      kind: job.kind,
      userId: job.userId,
      status: job.status,
      progress: job.progress,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };

    if (job.assignmentId !== undefined) {
      payload.assignmentId = String(job.assignmentId);
    }

    if (job.attemptId !== undefined) {
      payload.attemptId =
        job.attemptId === null ? NULL_SENTINEL : String(job.attemptId);
    }

    if (job.percentage !== undefined) {
      payload.percentage = String(job.percentage);
    }

    if (job.currentQuestion !== undefined) {
      payload.currentQuestion = String(job.currentQuestion);
    }

    if (job.totalQuestions !== undefined) {
      payload.totalQuestions = String(job.totalQuestions);
    }

    if (job.result !== undefined) {
      payload.result = JSON.stringify(job.result);
    }

    if (job.activeKeyHash) {
      payload.activeKeyHash = job.activeKeyHash;
    }

    return payload;
  }

  // Partial HSET payload for updateJobStatus: only the fields the caller
  // touched (always status/progress/updatedAt; percentage and result
  // only when explicitly set). Concurrent writers that don't pass
  // `result` simply leave the stored field alone instead of racing on
  // a stale snapshot.
  private serializeJobUpdate(
    updatedJob: StoredJobState,
    statusUpdate: JobStatusUpdate,
  ): Record<string, string> {
    const payload: Record<string, string> = {
      status: updatedJob.status,
      progress: updatedJob.progress,
      updatedAt: updatedJob.updatedAt,
    };
    if (statusUpdate.percentage !== undefined) {
      payload.percentage = String(updatedJob.percentage);
    }
    if (statusUpdate.result !== undefined) {
      payload.result = JSON.stringify(statusUpdate.result);
    }
    return payload;
  }

  private deserializeJob(rawJob: Record<string, string>): StoredJobState {
    return {
      id: rawJob.id,
      queueName: rawJob.queueName,
      jobName: rawJob.jobName,
      kind: rawJob.kind,
      userId: rawJob.userId,
      assignmentId:
        rawJob.assignmentId === undefined
          ? undefined
          : Number(rawJob.assignmentId),
      attemptId:
        rawJob.attemptId === undefined
          ? undefined
          : rawJob.attemptId === NULL_SENTINEL
            ? null
            : Number(rawJob.attemptId),
      status: rawJob.status,
      progress: rawJob.progress,
      percentage:
        rawJob.percentage === undefined ? undefined : Number(rawJob.percentage),
      currentQuestion:
        rawJob.currentQuestion === undefined
          ? undefined
          : Number(rawJob.currentQuestion),
      totalQuestions:
        rawJob.totalQuestions === undefined
          ? undefined
          : Number(rawJob.totalQuestions),
      result:
        rawJob.result === undefined
          ? undefined
          : (JSON.parse(rawJob.result) as unknown),
      activeKeyHash: rawJob.activeKeyHash,
      createdAt: rawJob.createdAt,
      updatedAt: rawJob.updatedAt,
    };
  }

  private toPublicJob(job: StoredJobState): JobStateRecord {
    return {
      id: job.id,
      queueName: job.queueName,
      jobName: job.jobName,
      kind: job.kind,
      userId: job.userId,
      assignmentId: job.assignmentId,
      attemptId: job.attemptId,
      status: job.status,
      progress: job.progress,
      percentage: job.percentage,
      currentQuestion: job.currentQuestion,
      totalQuestions: job.totalQuestions,
      result: job.result,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  private toMessageEvent(job: JobStateRecord): MessageEvent {
    const type = this.isTerminalStatus(job.status)
      ? job.status === "Failed"
        ? "error"
        : "finalize"
      : "update";

    return {
      type,
      data: JSON.stringify({
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        percentage: job.percentage ?? 0,
        currentQuestion: job.currentQuestion,
        totalQuestions: job.totalQuestions,
        result:
          job.result === undefined ? undefined : JSON.stringify(job.result),
        done: this.isTerminalStatus(job.status),
        timestamp: job.updatedAt,
      }),
    } as MessageEvent;
  }

  private isActiveStatus(status: string): boolean {
    return (
      status === "Pending" ||
      status === "Processing" ||
      status === "In Progress"
    );
  }

  private isTerminalStatus(status: string): boolean {
    return status === "Completed" || status === "Failed";
  }

  private normalizePercentage(percentage?: number): number | undefined {
    if (percentage === undefined) {
      return undefined;
    }

    return Math.max(0, Math.min(100, Math.round(percentage)));
  }
}
