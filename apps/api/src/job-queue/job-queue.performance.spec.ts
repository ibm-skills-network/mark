import { Logger } from "@nestjs/common";
import { Worker } from "bullmq";
import { decryptJobPayload } from "./job-payload.crypto";
import { JobQueueService } from "./job-queue.service";
import { JobStateService } from "./job-state.service";
import {
  createRedisTestHarness,
  isRedisTestEnvironmentAvailable,
  RedisTestHarness,
  waitForCondition,
} from "../../../../test-support/redis-test-harness";

const describePerformance =
  process.env.RUN_JOB_QUEUE_PERF_TESTS === "true" &&
  isRedisTestEnvironmentAvailable()
    ? describe
    : describe.skip;

describePerformance("job-queue performance", () => {
  const jobQueueSecretEnv = "JOB_QUEUE_SECRET"; // pragma: allowlist secret
  const originalRedisUrl = process.env.REDIS_URL;
  const originalQueueKeyValue = process.env[jobQueueSecretEnv];
  const queueName = "mark.job-queue.performance";
  const totalJobs = 100;

  let redisHarness: RedisTestHarness | undefined;
  let loggerSpy: jest.SpyInstance | undefined;

  beforeAll(async () => {
    redisHarness = await createRedisTestHarness();
    process.env.REDIS_URL = redisHarness.redisUrl;
    process.env[jobQueueSecretEnv] = "performance-secret";
    loggerSpy = jest
      .spyOn(Logger.prototype, "log")
      .mockImplementation(() => undefined);
  }, 60_000);

  beforeEach(async () => {
    if (!redisHarness) {
      throw new Error("Redis test harness was not initialized");
    }
    await redisHarness.flush();
  });

  afterAll(async () => {
    if (originalRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = originalRedisUrl;
    }

    if (originalQueueKeyValue === undefined) {
      delete process.env[jobQueueSecretEnv];
    } else {
      process.env[jobQueueSecretEnv] = originalQueueKeyValue;
    }

    await redisHarness?.stop();
    loggerSpy?.mockRestore();
  });

  it("meets the baseline end-to-end throughput budget for queue processing", async () => {
    const queueService = new JobQueueService();
    const jobStateService = new JobStateService();
    const workerConnection = redisHarness.createClient();
    const worker = new Worker(
      queueName,
      async (job) => {
        const payload = decryptJobPayload<{ jobId: string }>(job.data);

        await jobStateService.updateJobStatus(payload.jobId, {
          status: "Completed",
          progress: "Done",
          percentage: 100,
          result: { ok: true },
        });
      },
      {
        connection: workerConnection,
        concurrency: 20,
      },
    );

    await worker.waitUntilReady();

    const trackedJobs = await Promise.all(
      Array.from({ length: totalJobs }, async (_, index) =>
        jobStateService.createJob({
          queueName,
          jobName: "performance.process",
          kind: "performance",
          userId: `user-${index}`,
          status: "Pending",
          progress: "Queued",
        }),
      ),
    );

    const startedAt = Date.now();

    await Promise.all(
      trackedJobs.map(async (trackedJob) =>
        queueService.enqueue(queueName, "performance.process", {
          jobId: trackedJob.id,
        }),
      ),
    );

    await waitForCondition(
      async () => {
        const jobs = await Promise.all(
          trackedJobs.map(async (trackedJob) =>
            jobStateService.getJob(trackedJob.id),
          ),
        );

        return jobs.every((job) => job?.status === "Completed");
      },
      20_000,
      50,
    );

    const durationMs = Date.now() - startedAt;
    const jobsPerSecond = totalJobs / (durationMs / 1000);

    console.info(
      `[job-queue.performance] processed ${totalJobs} jobs in ${durationMs}ms (${jobsPerSecond.toFixed(2)} jobs/s)`,
    );

    expect(durationMs).toBeLessThan(10_000);
    expect(jobsPerSecond).toBeGreaterThan(10);

    await worker.close();
    await workerConnection.quit();
    await queueService.onModuleDestroy();
    await jobStateService.onModuleDestroy();
  }, 30_000);
});
