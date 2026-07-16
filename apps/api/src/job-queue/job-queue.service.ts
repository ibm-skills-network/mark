import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Job, JobsOptions, JobState, Queue } from "bullmq";
import IORedis from "ioredis";
import {
  JOB_PRIORITIES,
  JOB_QUEUE_NAMES,
  JobName,
} from "./job-queue.constants";
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

/**
 * Compact, payload-free throughput sample for one queue over a trailing window.
 *
 * The per-minute counts come straight from a Redis ZCOUNT over BullMQ's
 * completed/failed sorted sets (scored by finish timestamp) — no job hashes are
 * hydrated, so this stays cheap regardless of queue throughput. The average
 * wait/run timings hydrate only a tiny, bounded sample of the most-recent
 * completed jobs inside the window, carrying lifecycle timestamps only — never
 * job data, so no encrypted payloads or PII are touched.
 */
export interface ThroughputSample {
  completedPerMin: number;
  failedPerMin: number;
  avgSample: Array<{
    timestamp: number | null;
    processedOn: number | null;
    finishedOn: number | null;
  }>;
}

export interface RedisInfo {
  usedMemoryBytes: number | null;
  usedMemoryHuman: string | null;
  connectedClients: number | null;
  opsPerSec: number | null;
}

// Trailing window (ms) over which throughput rates and averages are derived.
// Kept here so the windowing happens inside the Redis query rather than after
// hydrating jobs into the read-model.
const THROUGHPUT_WINDOW_MS = 60_000;

// Hard cap on how many completed jobs are hydrated per call to derive the
// average wait/run timings. The per-minute counts never hydrate a job (ZCOUNT
// only); only the averages read job hashes, and only this many of the most
// recent ones inside the window — so hydration cost is a tiny constant no
// matter how busy the queue is.
const THROUGHPUT_AVG_SAMPLE_MAX = 20;

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
        // Cap retained job history by count. BullMQ keeps completed and failed
        // jobs — each carrying a full encrypted payload — until evicted; at 1000
        // per state across every queue this history dominated Redis memory. A
        // cap of 100 leaves ample history for the admin failed-jobs drill-down
        // and post-mortems while bounding worst-case retention, including during
        // a failure storm where 1000 retained payloads per queue was the risk.
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 },
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
    // Centralized priority assignment: BullMQ runs unprioritized jobs before
    // ALL prioritized ones, so every job class on a prioritized queue must
    // get its priority here — call sites cannot be trusted to remember.
    // An explicit options.priority still wins for one-offs, but pull it out
    // rather than spreading raw options last: a spread copies an explicit
    // `priority: undefined` over the mapped value and silently unprioritizes
    // the job (which would then jump ahead of every prioritized job). The
    // nullish fallback keeps the mapped priority when the override is absent
    // or explicitly undefined.
    const mappedPriority = JOB_PRIORITIES[jobName as JobName];
    const { priority: overridePriority, ...restOptions } = options;
    const resolvedPriority = overridePriority ?? mappedPriority;
    const jobOptions: JobsOptions = {
      ...(resolvedPriority !== undefined && { priority: resolvedPriority }),
      ...restOptions,
    };
    this.logger.log(
      `Enqueuing job ${jobName} on queue ${queueName}` +
        (jobOptions.priority === undefined
          ? ""
          : ` with priority ${jobOptions.priority}`),
    );
    await this.getQueue(queueName).add(
      jobName,
      encryptJobPayload(payload),
      jobOptions,
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
      "prioritized",
      "active",
      "delayed",
      "failed",
      "completed",
      "paused",
    );
    return {
      // BullMQ v5 keeps queued jobs that carry a priority in a separate
      // `prioritized` ZSET, not the plain `wait` list. Every job class on the
      // attempt/translation queues now gets a priority via JOB_PRIORITIES, so
      // counting only `waiting` would report a badly backed-up grading or
      // translation queue as empty. Both are "queued, not yet started," so
      // fold them into the single waiting number the dashboard shows.
      waiting: (counts.waiting ?? 0) + (counts.prioritized ?? 0),
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

  /**
   * Recent in-flight (active) jobs for a queue, newest-first. Returns the raw
   * BullMQ jobs; decryption and PII handling are the read-model's job, not this
   * layer's.
   */
  async getActiveJobs(queueName: string, limit: number): Promise<Job[]> {
    const queue = this.getQueue(queueName) as Queue<unknown, unknown>;
    return queue.getActive(0, Math.max(0, limit - 1));
  }

  /**
   * Throughput sample for one queue over the trailing window.
   *
   * BullMQ v5 keeps completed/failed jobs in sorted sets scored by their finish
   * timestamp (ms). The per-minute counts are a Redis ZCOUNT over those sets for
   * the window — no job hashes are hydrated, so this is cheap and not capped at
   * a fixed scan size (busy queues are no longer undercounted). For the average
   * wait/run timings, only a tiny bounded sample of the most-recent completed
   * jobs inside the window is hydrated, and only their lifecycle timestamps are
   * read — never payloads, so no PII is touched.
   */
  async getThroughputSample(queueName: string): Promise<ThroughputSample> {
    const queue = this.getQueue(queueName) as Queue<unknown, unknown>;
    const completedKey = queue.toKey("completed");
    const failedKey = queue.toKey("failed");
    const windowStart = Date.now() - THROUGHPUT_WINDOW_MS;
    const windowStartScore = String(windowStart);

    // `queue.client` resolves to the shared ioredis client. In cluster mode the
    // BullMQ hash-tag prefix keeps a queue's keys colocated, so each single-key
    // command below stays on one node.
    const client = await queue.client;

    // Per-minute rates: count members scored at-or-after the window start. The
    // score is the finish timestamp, so this is "finished in the last minute".
    const [completedPerMin, failedPerMin, recentCompletedIds] =
      await Promise.all([
        client.zcount(completedKey, windowStartScore, "+inf"),
        client.zcount(failedKey, windowStartScore, "+inf"),
        // Newest-first ids of completed jobs inside the window, capped hard.
        client.zrevrangebyscore(
          completedKey,
          "+inf",
          windowStartScore,
          "LIMIT",
          0,
          THROUGHPUT_AVG_SAMPLE_MAX,
        ),
      ]);

    const avgSample = await this.hydrateTimingSample(queue, recentCompletedIds);

    return {
      completedPerMin: this.toCount(completedPerMin),
      failedPerMin: this.toCount(failedPerMin),
      avgSample,
    };
  }

  /**
   * Hydrate only the lifecycle timestamps (no payload) for a small, bounded set
   * of completed job ids. A single missing/unreadable job is skipped rather than
   * failing the whole sample.
   */
  private async hydrateTimingSample(
    queue: Queue<unknown, unknown>,
    jobIds: string[],
  ): Promise<ThroughputSample["avgSample"]> {
    const jobs = await Promise.all(jobIds.map((jobId) => queue.getJob(jobId)));
    const sample: ThroughputSample["avgSample"] = [];
    for (const job of jobs) {
      if (!job) {
        // Job aged out between the ZSET read and the hydrate — skip it.
        continue;
      }
      sample.push({
        timestamp: this.toFiniteOrNull(job.timestamp),
        processedOn: this.toFiniteOrNull(job.processedOn),
        finishedOn: this.toFiniteOrNull(job.finishedOn),
      });
    }
    return sample;
  }

  private toCount(value: number): number {
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  /**
   * Retry a job only if it currently exists and is in the failed state.
   * Returns false (never throws) when the job is missing or not failed, so a
   * raced or already-retried id is a no-op rather than an error.
   */
  async retryFailedJob(queueName: string, jobId: string): Promise<boolean> {
    this.assertKnownQueue(queueName);
    const queue = this.getQueue(queueName) as Queue<unknown, unknown>;
    const job = await queue.getJob(jobId);
    if (!job) {
      return false;
    }
    const state = await job.getState();
    if (state !== "failed") {
      return false;
    }
    await job.retry("failed");
    return true;
  }

  /**
   * Remove a job only if it currently exists and is in the failed state.
   * Returns false (never throws) when the job is missing or not failed, so the
   * caller cannot remove an active job by racing its id.
   */
  async removeFailedJob(queueName: string, jobId: string): Promise<boolean> {
    this.assertKnownQueue(queueName);
    const queue = this.getQueue(queueName) as Queue<unknown, unknown>;
    const job = await queue.getJob(jobId);
    if (!job) {
      return false;
    }
    const state = await job.getState();
    if (state !== "failed") {
      return false;
    }
    await job.remove();
    return true;
  }

  /**
   * Parse the fields the dashboard needs out of Redis `INFO`. Missing or
   * unparseable fields degrade to null rather than failing the call.
   */
  async getRedisInfo(): Promise<RedisInfo> {
    const raw = await this.getConnection().info();
    const fields = this.parseRedisInfo(raw);
    return {
      usedMemoryBytes: this.parseIntField(fields.get("used_memory")),
      usedMemoryHuman: fields.get("used_memory_human") ?? null,
      connectedClients: this.parseIntField(fields.get("connected_clients")),
      opsPerSec: this.parseIntField(fields.get("instantaneous_ops_per_sec")),
    };
  }

  /**
   * Number of live worker connections BullMQ sees registered against a queue.
   */
  async getQueueWorkerConnections(queueName: string): Promise<number> {
    const queue = this.getQueue(queueName) as Queue<unknown, unknown>;
    const workers = await queue.getWorkers();
    return workers.length;
  }

  async isQueuePaused(queueName: string): Promise<boolean> {
    const queue = this.getQueue(queueName) as Queue<unknown, unknown>;
    return queue.isPaused();
  }

  private assertKnownQueue(queueName: string): void {
    if (!(Object.values(JOB_QUEUE_NAMES) as string[]).includes(queueName)) {
      // Generic error — never echo the offending value or hint at internals.
      throw new Error("Unknown queue");
    }
  }

  private toFiniteOrNull(value: number | undefined): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  private parseRedisInfo(raw: string): Map<string, string> {
    const fields = new Map<string, string>();
    for (const line of raw.split(/\r?\n/)) {
      // Section headers ("# Memory") and blank lines carry no field.
      if (!line || line.startsWith("#")) {
        continue;
      }
      const separatorIndex = line.indexOf(":");
      if (separatorIndex === -1) {
        continue;
      }
      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      if (key) {
        fields.set(key, value);
      }
    }
    return fields;
  }

  private parseIntField(value: string | undefined): number | null {
    if (value === undefined) {
      return null;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
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
