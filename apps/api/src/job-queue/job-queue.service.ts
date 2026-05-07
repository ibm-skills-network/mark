import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { JobsOptions, Queue } from "bullmq";
import IORedis from "ioredis";
import { encryptJobPayload } from "./job-payload.crypto";
import { createRedisConnection } from "./redis.connection";

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
