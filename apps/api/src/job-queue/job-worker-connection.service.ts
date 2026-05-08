import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from "@nestjs/common";
import IORedis from "ioredis";
import {
  DEFAULT_JOB_WORKER_CONNECT_RETRY_DELAY_MS,
  JOB_WORKER_HEARTBEAT_KEY_PREFIX,
} from "./job-worker-heartbeat.constants";
import { createRedisConnection } from "./redis.connection";

interface JobWorkerHeartbeat {
  hostname?: string;
  instanceId?: string;
  pid?: number;
  queues?: string[];
  updatedAt?: string;
  workerCount?: number;
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

    this.retryTimeout = setTimeout(() => {
      void this.checkJobWorkerConnection();
    }, this.getRetryDelayMs());
  }

  private async findActiveWorkerHeartbeat(): Promise<JobWorkerHeartbeat | null> {
    const keys = await this.scanHeartbeatKeys();
    for (const key of keys) {
      const rawHeartbeat = await this.getConnection().get(key);
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
