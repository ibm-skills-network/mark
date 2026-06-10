import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Job } from "bullmq";
import { S3Service } from "../../files/services/s3.service";
import { pickDomainIds } from "../../../job-queue/job-domain-ids";
// eslint-disable-next-line unicorn/prevent-abbreviations -- imported public contract names from job-file-refs
import { FileRef, pickFileRefs } from "../../../job-queue/job-file-refs";
import { JOB_QUEUE_NAMES } from "../../../job-queue/job-queue.constants";
import { decryptJobPayload } from "../../../job-queue/job-payload.crypto";
import {
  JobQueueService,
  ThroughputSample,
} from "../../../job-queue/job-queue.service";
import {
  JobWorkerConnectionService,
  JobWorkerHeartbeat,
} from "../../../job-queue/job-worker-connection.service";
import { QUEUE_METADATA, QueueRole } from "../../../job-queue/queue-metadata";

const HEARTBEAT_STALE_AFTER_MS = 20_000;
const FAILED_JOBS_MAX = 100;
const FAILED_JOBS_DEFAULT = 25;
const ACTIVE_JOBS_MAX = 100;
const ACTIVE_JOBS_DEFAULT = 25;
const FAILED_REASON_MAX_CHARS = 2000;
const STACKTRACE_MAX_ENTRIES = 20;
const STACKTRACE_ENTRY_MAX_CHARS = 2000;
const DOWNLOAD_URL_TTL_SECONDS = 600;

export interface QueueThroughputDto {
  completedPerMin: number;
  failedPerMin: number;
  avgWaitMs: number | null;
  avgRunMs: number | null;
}

export interface QueueStatDto {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  paused: number;
  role: QueueRole | null;
  concurrencyPerPod: number;
  livePods: number;
  clusterCapacity: number;
  isPaused: boolean;
  throughput: QueueThroughputDto | null;
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

// eslint-disable-next-line unicorn/prevent-abbreviations -- public DTO name matched verbatim by the frontend
export interface FileRefDto {
  filename: string;
  sizeBytes?: number;
  mimeType?: string;
  bucket?: string;
  storageKey?: string;
  downloadUrl: string | null;
}

export interface FailedJobDto {
  id: string;
  name: string;
  attemptsMade: number;
  maxAttempts: number;
  failedReason: string;
  failedAt: string | null;
  enqueuedAt: string | null;
  processedAt: string | null;
  finishedAt: string | null;
  stacktrace: string[];
  files: FileRefDto[];
  domainIds: Record<string, number | string>;
}

export interface ActiveJobDto {
  id: string;
  name: string;
  attemptsMade: number;
  maxAttempts: number;
  runningForMs: number | null;
  progress: number | object | null;
  processedBy: string | null;
  domainIds: Record<string, number | string>;
}

export interface RedisHealthDto {
  usedMemoryBytes: number | null;
  usedMemoryHuman: string | null;
  connectedClients: number | null;
  opsPerSec: number | null;
  workerConnections: number;
  heartbeatPods: number;
  reconciled: boolean;
}

@Injectable()
export class QueueStatusService {
  private readonly logger = new Logger(QueueStatusService.name);

  constructor(
    private readonly jobQueueService: JobQueueService,
    private readonly workerConnectionService: JobWorkerConnectionService,
    private readonly s3Service: S3Service,
  ) {}

  /**
   * Fetch the raw worker heartbeats (one Redis SCAN + per-key GET). Exposed so
   * the status endpoint can scan once per request and pass the result into both
   * getQueueStats() and getWorkers() instead of each scanning independently.
   */
  async getAllWorkerHeartbeats(): Promise<JobWorkerHeartbeat[]> {
    return this.workerConnectionService.getAllWorkerHeartbeats();
  }

  /**
   * Build the per-queue stat rows. Heartbeats may be supplied by the caller so a
   * single status request scans them once and shares them with getWorkers();
   * when omitted (other callers) they are fetched here to stay self-contained.
   */
  async getQueueStats(
    heartbeats?: JobWorkerHeartbeat[],
  ): Promise<QueueStatDto[]> {
    const names = Object.values(JOB_QUEUE_NAMES);
    const resolvedHeartbeats =
      heartbeats ??
      (await this.workerConnectionService.getAllWorkerHeartbeats());
    const livePodHeartbeats = this.liveHeartbeats(resolvedHeartbeats);

    return Promise.all(
      names.map(async (name): Promise<QueueStatDto> => {
        const metadata = QUEUE_METADATA[name];
        const role: QueueRole | null = metadata?.role ?? null;
        const { concurrencyPerPod, livePods, clusterCapacity } =
          this.deriveCapacity(
            name,
            livePodHeartbeats,
            metadata?.defaultConcurrencyPerPod ?? 0,
          );
        try {
          const [counts, isPaused, throughput] = await Promise.all([
            this.jobQueueService.getQueueCounts(name),
            this.jobQueueService.isQueuePaused(name),
            this.computeThroughput(name),
          ]);
          return {
            name,
            ...counts,
            role,
            concurrencyPerPod,
            livePods,
            clusterCapacity,
            isPaused,
            throughput,
          };
        } catch (error: unknown) {
          // One queue's Redis hiccup must not fail the whole dashboard.
          this.logger.warn(
            `Queue stats unavailable for ${name}: ${this.messageOf(error)}`,
          );
          return {
            name,
            waiting: 0,
            active: 0,
            delayed: 0,
            failed: 0,
            completed: 0,
            paused: 0,
            role,
            concurrencyPerPod,
            livePods,
            clusterCapacity,
            isPaused: false,
            throughput: null,
            unavailable: true,
          };
        }
      }),
    );
  }

  /**
   * Build the worker pod rows. Heartbeats may be supplied by the caller so a
   * single status request shares one scan with getQueueStats(); when omitted
   * they are fetched here.
   */
  async getWorkers(heartbeats?: JobWorkerHeartbeat[]): Promise<WorkerDto[]> {
    const resolvedHeartbeats =
      heartbeats ??
      (await this.workerConnectionService.getAllWorkerHeartbeats());
    const now = Date.now();
    return resolvedHeartbeats.map((hb): WorkerDto => {
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
    this.assertKnownQueue(queueName);
    const limit = this.clampLimit(
      requestedLimit,
      FAILED_JOBS_DEFAULT,
      FAILED_JOBS_MAX,
    );
    const jobs = await this.jobQueueService.getFailedJobs(queueName, limit);
    return Promise.all(jobs.map((job) => this.toFailedJobDto(job)));
  }

  async getActiveJobs(
    queueName: string,
    requestedLimit: number,
  ): Promise<ActiveJobDto[]> {
    this.assertKnownQueue(queueName);
    const limit = this.clampLimit(
      requestedLimit,
      ACTIVE_JOBS_DEFAULT,
      ACTIVE_JOBS_MAX,
    );
    const jobs = await this.jobQueueService.getActiveJobs(queueName, limit);
    const now = Date.now();
    return jobs.map((job) => this.toActiveJobDto(job, now));
  }

  async getRedisHealth(): Promise<RedisHealthDto> {
    const heartbeats =
      await this.workerConnectionService.getAllWorkerHeartbeats();
    const heartbeatPods = this.liveHeartbeats(heartbeats).length;

    const info = await this.jobQueueService.getRedisInfo();

    // Reconcile BullMQ's view of registered worker connections against the
    // number of live heartbeat pods. Each pod registers one Worker per queue,
    // so a single queue's connection count should track the live pod count.
    let workerConnections = 0;
    try {
      workerConnections = await this.jobQueueService.getQueueWorkerConnections(
        JOB_QUEUE_NAMES.ATTEMPT,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `Worker-connection probe failed: ${this.messageOf(error)}`,
      );
    }

    return {
      usedMemoryBytes: info.usedMemoryBytes,
      usedMemoryHuman: info.usedMemoryHuman,
      connectedClients: info.connectedClients,
      opsPerSec: info.opsPerSec,
      workerConnections,
      heartbeatPods,
      reconciled: workerConnections === heartbeatPods,
    };
  }

  /**
   * Retry a failed job. Returns true when the job was failed and re-queued,
   * false when the job is missing or not in the failed state (no-op refusal).
   * The queue allow-list and jobId validation are the controller's job.
   */
  async retryFailedJob(queueName: string, jobId: string): Promise<boolean> {
    this.assertKnownQueue(queueName);
    return this.jobQueueService.retryFailedJob(queueName, jobId);
  }

  /**
   * Remove a failed job. Returns true when the job was failed and removed,
   * false when the job is missing or not in the failed state (no-op refusal).
   */
  async removeFailedJob(queueName: string, jobId: string): Promise<boolean> {
    this.assertKnownQueue(queueName);
    return this.jobQueueService.removeFailedJob(queueName, jobId);
  }

  private async toFailedJobDto(job: Job): Promise<FailedJobDto> {
    const payload = this.decryptOrEmpty(job);
    const files = await this.toFileRefDtos(payload);
    return {
      id: String(job.id ?? "unknown"),
      name: job.name,
      attemptsMade: job.attemptsMade ?? 0,
      maxAttempts: job.opts?.attempts ?? 1,
      failedReason: (job.failedReason ?? "").slice(0, FAILED_REASON_MAX_CHARS),
      failedAt: this.toIso(job.finishedOn),
      enqueuedAt: this.toIso(job.timestamp),
      processedAt: this.toIso(job.processedOn),
      finishedAt: this.toIso(job.finishedOn),
      stacktrace: this.capStacktrace(job.stacktrace),
      files,
      domainIds: pickDomainIds(payload),
    };
  }

  private toActiveJobDto(job: Job, now: number): ActiveJobDto {
    const payload = this.decryptOrEmpty(job);
    const runningForMs =
      typeof job.processedOn === "number" && Number.isFinite(job.processedOn)
        ? Math.max(0, now - job.processedOn)
        : null;
    return {
      id: String(job.id ?? "unknown"),
      name: job.name,
      attemptsMade: job.attemptsMade ?? 0,
      maxAttempts: job.opts?.attempts ?? 1,
      runningForMs,
      progress: this.normalizeProgress(job.progress),
      processedBy: typeof job.processedBy === "string" ? job.processedBy : null,
      domainIds: pickDomainIds(payload),
    };
  }

  /**
   * Build download-ready file refs from a decrypted payload. Each ref with a
   * bucket + storage key gets a short-lived presigned getObject URL. A presign
   * failure degrades that one ref to downloadUrl: null — a missing link must
   * not fail the drill-down. URLs and filenames are never logged.
   */
  private async toFileRefDtos(
    payload: Record<string, unknown>,
  ): Promise<FileRefDto[]> {
    const references = pickFileRefs(payload);
    return Promise.all(
      references.map((reference) => this.toFileRefDto(reference)),
    );
  }

  private async toFileRefDto(reference: FileRef): Promise<FileRefDto> {
    const base: FileRefDto = {
      filename: reference.filename,
      downloadUrl: null,
    };
    if (reference.sizeBytes !== undefined) base.sizeBytes = reference.sizeBytes;
    if (reference.mimeType !== undefined) base.mimeType = reference.mimeType;
    if (reference.bucket !== undefined) base.bucket = reference.bucket;
    if (reference.storageKey !== undefined) {
      base.storageKey = reference.storageKey;
    }

    if (!reference.bucket || !reference.storageKey) {
      return base;
    }

    // Only presign against a bucket the app is actually configured to use. The
    // bucket here comes from a decrypted job payload — hostile input — so an
    // unrecognized bucket must never be turned into a signed URL (it could point
    // at an arbitrary object). Degrade to no link instead. Do NOT log the
    // bucket/key/url; an empty or foreign bucket value is not noteworthy here.
    if (!this.s3Service.isConfiguredUploadBucket(reference.bucket)) {
      return base;
    }

    try {
      base.downloadUrl = await this.s3Service.getSignedUrl("getObject", {
        Bucket: reference.bucket,
        Key: reference.storageKey,
        Expires: DOWNLOAD_URL_TTL_SECONDS,
      });
    } catch (error: unknown) {
      // Degrade to no link. Do NOT log the url, filename, bucket, or key —
      // any of these can carry PII or be sensitive. Message + nothing else.
      this.logger.warn(
        `Presign failed for a file ref: ${this.messageOf(error)}`,
      );
    }
    return base;
  }

  private async computeThroughput(
    queueName: string,
  ): Promise<QueueThroughputDto | null> {
    let sample: ThroughputSample;
    try {
      sample = await this.jobQueueService.getThroughputSample(queueName);
    } catch (error: unknown) {
      this.logger.warn(
        `Throughput sample unavailable for ${queueName}: ${this.messageOf(
          error,
        )}`,
      );
      return null;
    }
    return this.throughputFromSample(sample);
  }

  private throughputFromSample(sample: ThroughputSample): QueueThroughputDto {
    // Per-minute counts already come windowed from the ZCOUNT query. Only the
    // average wait/run timings are derived here, from the small bounded sample
    // of recent completed jobs.
    const waits: number[] = [];
    const runs: number[] = [];
    for (const entry of sample.avgSample) {
      if (entry.processedOn !== null && entry.timestamp !== null) {
        const wait = entry.processedOn - entry.timestamp;
        if (wait >= 0) waits.push(wait);
      }
      if (entry.finishedOn !== null && entry.processedOn !== null) {
        const run = entry.finishedOn - entry.processedOn;
        if (run >= 0) runs.push(run);
      }
    }

    return {
      completedPerMin: sample.completedPerMin,
      failedPerMin: sample.failedPerMin,
      avgWaitMs: this.mean(waits),
      avgRunMs: this.mean(runs),
    };
  }

  private mean(values: number[]): number | null {
    if (values.length === 0) return null;
    const total = values.reduce((sum, value) => sum + value, 0);
    return Math.round(total / values.length);
  }

  /**
   * Resolve capacity for one queue from the live heartbeats.
   *
   * clusterCapacity is the SUM over live pods serving the queue of each pod's
   * own concurrency — its published concurrencyByQueue value when present,
   * otherwise the static metadata default for pods that predate that field.
   * Summing (rather than max × pod count) keeps the number accurate during a
   * rolling deploy when pods run mixed concurrency. livePods counts heartbeats
   * whose worker set includes this queue. concurrencyPerPod is a single
   * representative value (the max across pods, or the default when no pod
   * published one) for display only — clusterCapacity is the authoritative
   * total and is not derived from it.
   */
  private deriveCapacity(
    queueName: string,
    liveHeartbeats: JobWorkerHeartbeat[],
    defaultConcurrencyPerPod: number,
  ): { concurrencyPerPod: number; livePods: number; clusterCapacity: number } {
    let livePods = 0;
    let clusterCapacity = 0;
    let maxPublished = 0;
    let sawPublishedForQueue = false;

    for (const hb of liveHeartbeats) {
      const servesQueue = Array.isArray(hb.queues)
        ? hb.queues.includes(queueName)
        : false;
      if (!servesQueue) {
        continue;
      }
      livePods += 1;
      const published = hb.concurrencyByQueue?.[queueName];
      const podConcurrency =
        typeof published === "number" && Number.isFinite(published)
          ? published
          : defaultConcurrencyPerPod;
      clusterCapacity += podConcurrency;
      if (typeof published === "number" && Number.isFinite(published)) {
        maxPublished = Math.max(maxPublished, published);
        sawPublishedForQueue = true;
      }
    }

    const concurrencyPerPod = sawPublishedForQueue
      ? maxPublished
      : defaultConcurrencyPerPod;

    return { concurrencyPerPod, livePods, clusterCapacity };
  }

  private liveHeartbeats(
    heartbeats: JobWorkerHeartbeat[],
  ): JobWorkerHeartbeat[] {
    const now = Date.now();
    return heartbeats.filter((hb) => {
      const updatedAt = typeof hb.updatedAt === "string" ? hb.updatedAt : null;
      if (!updatedAt) return false;
      const lastSeenMs = now - Date.parse(updatedAt);
      return (
        Number.isFinite(lastSeenMs) && lastSeenMs <= HEARTBEAT_STALE_AFTER_MS
      );
    });
  }

  private decryptOrEmpty(job: Job): Record<string, unknown> {
    try {
      return decryptJobPayload<Record<string, unknown>>(job.data);
    } catch (error: unknown) {
      // Drill-down must not fail because one payload can't be read. No ids in
      // the log line — name/id are not PII but the payload contents are.
      this.logger.warn(
        `Job payload decrypt failed for ${job.name ?? "?"}#${
          job.id ?? "?"
        }: ${this.messageOf(error)}`,
      );
      return {};
    }
  }

  private normalizeProgress(progress: Job["progress"]): number | object | null {
    if (typeof progress === "number" && Number.isFinite(progress)) {
      return progress;
    }
    if (progress && typeof progress === "object") {
      return progress;
    }
    return null;
  }

  private capStacktrace(stacktrace: unknown): string[] {
    if (!Array.isArray(stacktrace)) return [];
    return stacktrace
      .filter((entry): entry is string => typeof entry === "string")
      .slice(0, STACKTRACE_MAX_ENTRIES)
      .map((entry) => entry.slice(0, STACKTRACE_ENTRY_MAX_CHARS));
  }

  private toIso(value: number | undefined): string | null {
    return typeof value === "number" && Number.isFinite(value)
      ? new Date(value).toISOString()
      : null;
  }

  private clampLimit(value: number, fallback: number, max: number): number {
    if (!Number.isFinite(value) || value <= 0) return fallback;
    return Math.min(Math.floor(value), max);
  }

  private assertKnownQueue(queueName: string): void {
    if (!(Object.values(JOB_QUEUE_NAMES) as string[]).includes(queueName)) {
      // Generic error — do not echo the offending value or hint at internals.
      throw new NotFoundException("Unknown queue");
    }
  }

  private messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
