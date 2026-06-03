import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Job, JobsOptions, JobState, Queue } from "bullmq";
import IORedis from "ioredis";
import { encryptJobPayload } from "./job-payload.crypto";
import { createRedisConnection } from "./redis.connection";

export interface QueueCounts {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  paused: number;
}

@Injectable()
export class JobQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(JobQueueService.name);
  private connection?: IORedis;
  private readonly queues = new Map<string, Queue>();

  private getConnection(): IORedis {
    if (!this.connection) {
      this.connection = createRedisConnection();
    }

    return this.connection;
  }

  private getQueue(queueName: string): Queue {
    const existingQueue = this.queues.get(queueName);
    if (existingQueue) {
      return existingQueue;
    }

    const queue = new Queue(queueName, {
      connection: this.getConnection(),
      defaultJobOptions: {
        attempts: 3,
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    });

    this.queues.set(queueName, queue);
    return queue;
  }

  async enqueue(
    queueName: string,
    jobName: string,
    payload: unknown,
    options: JobsOptions = {},
  ): Promise<void> {
    this.logger.log(`Enqueuing job ${jobName} on queue ${queueName}`);
    await this.getQueue(queueName).add(
      jobName,
      encryptJobPayload(payload),
      options,
    );
  }

  /**
   * Look up a job by id and return it only if it is still in flight.
   *
   * BullMQ keeps completed/failed jobs in history for inspection, which would
   * cause a deterministic-id dedup check to incorrectly block a fresh enqueue.
   * Treat completed/failed/unknown as "no active job"; treat waiting, active,
   * delayed, paused, prioritized, and waiting-children as active.
   */
  async findActiveJob(
    queueName: string,
    jobId: string,
  ): Promise<{ id: string; state: JobState | "unknown" } | null> {
    const queue = this.getQueue(queueName) as Queue<unknown, unknown>;
    const job = await queue.getJob(jobId);
    if (!job) {
      return null;
    }

    const state: JobState | "unknown" = await job.getState();
    if (state === "completed" || state === "failed" || state === "unknown") {
      return null;
    }

    const resolvedId: string = job.id ?? jobId;
    return { id: resolvedId, state };
  }

  async getQueueCounts(queueName: string): Promise<QueueCounts> {
    const counts = await this.getQueue(queueName).getJobCounts(
      "waiting",
      "active",
      "delayed",
      "failed",
      "completed",
      "paused",
    );
    return {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      delayed: counts.delayed ?? 0,
      failed: counts.failed ?? 0,
      completed: counts.completed ?? 0,
      paused: counts.paused ?? 0,
    };
  }

  async getFailedJobs(queueName: string, limit: number): Promise<Job[]> {
    const queue = this.getQueue(queueName) as Queue<unknown, unknown>;
    return queue.getFailed(0, Math.max(0, limit - 1));
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      [...this.queues.values()].map(async (queue) => {
        await queue.close();
      }),
    );
    if (this.connection) {
      await this.connection.quit();
    }
  }
}
