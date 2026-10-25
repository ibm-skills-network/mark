import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from "@nestjs/common";
import IORedis from "ioredis";
import {
  DEFAULT_JOB_WORKER_CONNECT_RETRY_DELAY_MS,
  DEFAULT_JOB_WORKER_CONNECTED_CHECK_INTERVAL_MS,
  JOB_WORKER_HEARTBEAT_INDEX_KEY,
  JOB_WORKER_HEARTBEAT_KEY_PREFIX,
} from "./job-worker-heartbeat.constants";
import { createRedisConnection } from "./redis.connection";

export interface JobWorkerHeartbeat {
  hostname?: string;
  instanceId?: string;
  pid?: number;
  queues?: string[];
  startedAt?: string;
  updatedAt?: string;
  workerCount?: number;
  // Per-queue concurrency the publishing pod actually configured its workers
  // with. Optional so heartbeats written by older pods (which never wrote this
  // field) still parse; the read-model falls back to static defaults when it
  // is absent.
  concurrencyByQueue?: Record<string, number>;
}

@Injectable()
export class JobWorkerConnectionService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(JobWorkerConnectionService.name);
  private connection?: IORedis;
  private retryTimeout?: NodeJS.Timeout;
  private destroyed = false;
  private connected = false;
  private failedAttempts = 0;

  onApplicationBootstrap(): void {
    void this.checkJobWorkerConnection();
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
    }
    if (this.connection) {
      await this.connection.quit().catch(() => {
        this.connection?.disconnect();
      });
    }
  }

  private async checkJobWorkerConnection(): Promise<void> {
    if (this.destroyed) {
      return;
    }

    try {
      const heartbeat = await this.findActiveWorkerHeartbeat();
      if (heartbeat) {
        this.handleConnected(heartbeat);
      } else {
        this.handleConnectionFailure("No active job worker heartbeat found");
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.handleConnectionFailure(errorMessage);
    } finally {
      this.scheduleRetry();
    }
  }

  private handleConnected(heartbeat: JobWorkerHeartbeat): void {
    const wasDisconnected = !this.connected;
    this.connected = true;
    this.failedAttempts = 0;

    if (wasDisconnected) {
      this.logger.log(
        `Connected to jobs worker${heartbeat.instanceId ? ` ${heartbeat.instanceId}` : ""}`,
      );
    }
  }

  private handleConnectionFailure(reason: string): void {
    this.failedAttempts += 1;
    if (this.connected) {
      this.logger.warn(`Lost connection to jobs worker: ${reason}`);
    } else if (this.failedAttempts === 1 || this.failedAttempts % 5 === 0) {
      this.logger.warn(
        `Jobs worker unavailable (${reason}). Retrying in ${this.getRetryDelayMs()}ms`,
      );
    }

    this.connected = false;
  }

  private scheduleRetry(): void {
    if (this.destroyed) {
      return;
    }

    // Poll quickly only while no worker is visible; once connected the
    // check is a liveness log, not a dependency, so it can idle.
    const delay = this.connected
      ? DEFAULT_JOB_WORKER_CONNECTED_CHECK_INTERVAL_MS
      : this.getRetryDelayMs();
    this.retryTimeout = setTimeout(() => {
      void this.checkJobWorkerConnection();
    }, delay);
  }

  private async findActiveWorkerHeartbeat(): Promise<JobWorkerHeartbeat | null> {
    const keys = await this.listHeartbeatKeys();
    for (const key of keys) {
      const rawHeartbeat = await this.readHeartbeat(key);
      if (!rawHeartbeat) {
        continue;
      }

      try {
        return JSON.parse(rawHeartbeat) as JobWorkerHeartbeat;
      } catch {
        return { instanceId: key };
      }
    }

    return null;
  }

  async getAllWorkerHeartbeats(): Promise<JobWorkerHeartbeat[]> {
    const keys = await this.listHeartbeatKeys();
    const heartbeats: JobWorkerHeartbeat[] = [];
    for (const key of keys) {
      const raw = await this.readHeartbeat(key);
      if (!raw) continue;
      try {
        heartbeats.push(JSON.parse(raw) as JobWorkerHeartbeat);
      } catch {
        // Skip a corrupt heartbeat value rather than failing the whole read.
        this.logger.warn(`Skipping unparseable worker heartbeat at ${key}`);
      }
    }
    return heartbeats;
  }

  // Workers register their heartbeat key in a set, so the live list is one
  // SMEMBERS. An empty set means no worker of this version has registered
  // yet (or none is running), so fall back to a keyspace scan; the scan is
  // the expensive path and only runs while the set is empty.
  private async listHeartbeatKeys(): Promise<string[]> {
    const indexed = await this.getConnection().smembers(
      JOB_WORKER_HEARTBEAT_INDEX_KEY,
    );
    if (indexed.length > 0) {
      return indexed;
    }
    return this.scanHeartbeatKeys();
  }

  // A heartbeat key expires on its own when a worker dies without cleaning
  // up; drop such stale members so the set never grows past the live set.
  private async readHeartbeat(key: string): Promise<string | null> {
    const raw = await this.getConnection().get(key);
    if (raw === null) {
      await this.getConnection()
        .srem(JOB_WORKER_HEARTBEAT_INDEX_KEY, key)
        .catch(() => null);
    }
    return raw;
  }

  private async scanHeartbeatKeys(): Promise<string[]> {
    const keys: string[] = [];
    let cursor = "0";

    do {
      const [nextCursor, batch] = await this.getConnection().scan(
        cursor,
        "MATCH",
        `${JOB_WORKER_HEARTBEAT_KEY_PREFIX}:*`,
        "COUNT",
        "100",
      );
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== "0");

    return keys;
  }

  private getConnection(): IORedis {
    if (!this.connection) {
      this.connection = createRedisConnection();
    }

    return this.connection;
  }

  private getRetryDelayMs(): number {
    const parsedDelay = Number.parseInt(
      process.env.JOB_WORKER_CONNECT_RETRY_DELAY_MS ?? "",
      10,
    );
    return Number.isFinite(parsedDelay) && parsedDelay > 0
      ? parsedDelay
      : DEFAULT_JOB_WORKER_CONNECT_RETRY_DELAY_MS;
  }
}
