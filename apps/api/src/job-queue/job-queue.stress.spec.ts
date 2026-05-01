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

const describeStress =
  process.env.RUN_JOB_QUEUE_STRESS_TESTS === "true" &&
  isRedisTestEnvironmentAvailable()
    ? describe
    : describe.skip;

describeStress("job-queue stress", () => {
  const jobQueueSecretEnv = "JOB_QUEUE_SECRET"; // pragma: allowlist secret
  const originalRedisUrl = process.env.REDIS_URL;
  const originalQueueKeyValue = process.env[jobQueueSecretEnv];
  const queueName = "mark.job-queue.stress";
  const totalJobs = 200;

  let redisHarness: RedisTestHarness | undefined;
  let loggerSpy: jest.SpyInstance | undefined;

  beforeAll(async () => {
    redisHarness = await createRedisTestHarness();
    process.env.REDIS_URL = redisHarness.redisUrl;
    process.env[jobQueueSecretEnv] = "stress-secret";
    loggerSpy = jest
      .spyOn(Logger.prototype, "log")
      .mockImplementation(() => undefined);
  });

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

  it("processes a high-volume mixed workload without dropping or corrupting job state", async () => {
    const queueService = new JobQueueService();
    const jobStateService = new JobStateService();
    const workerConnection = redisHarness.createClient();
    const worker = new Worker(
      queueName,
      async (job) => {
        const payload = decryptJobPayload<{
          jobId: string;
          index: number;
          shouldFail: boolean;
        }>(job.data);

        await jobStateService.updateJobStatus(payload.jobId, {
          status: "Processing",
          progress: `Processing ${payload.index}`,
          percentage: 50,
        });
        await jobStateService.updateJobStatus(payload.jobId, {
          status: payload.shouldFail ? "Failed" : "Completed",
          progress: payload.shouldFail ? "Failed" : "Completed",
          percentage: 100,
          result: {
            index: payload.index,
            shouldFail: payload.shouldFail,
          },
        });
      },
      {
        connection: workerConnection,
        concurrency: 25,
      },
    );

    await worker.waitUntilReady();

    const trackedJobs = await Promise.all(
      Array.from({ length: totalJobs }, async (_, index) => {
        const activeKey = `stress:${index}`;
        const trackedJob = await jobStateService.createJob({
          queueName,
          jobName: "stress.process",
          kind: "stress",
          userId: `user-${index}`,
          status: "Pending",
          progress: "Queued",
          activeKey,
        });

        await queueService.enqueue(queueName, "stress.process", {
          jobId: trackedJob.id,
          index,
          shouldFail: index % 17 === 0,
        });

        return { activeKey, trackedJob };
      }),
    );

    await waitForCondition(
      async () => {
        const jobs = await Promise.all(
          trackedJobs.map(async ({ trackedJob }) =>
            jobStateService.getJob(trackedJob.id),
          ),
        );

        return jobs.every(
          (job) => job?.status === "Completed" || job?.status === "Failed",
        );
      },
      30_000,
      100,
    );

    const storedJobs = await Promise.all(
      trackedJobs.map(async ({ activeKey, trackedJob }) => ({
        activeJob: await jobStateService.findActiveJob(activeKey),
        storedJob: await jobStateService.getJob(trackedJob.id),
      })),
    );

    expect(
      storedJobs.filter(({ storedJob }) => storedJob?.status === "Completed"),
    ).toHaveLength(totalJobs - Math.ceil(totalJobs / 17));
    expect(
      storedJobs.filter(({ storedJob }) => storedJob?.status === "Failed"),
    ).toHaveLength(Math.ceil(totalJobs / 17));
    expect(storedJobs.every(({ activeJob }) => activeJob === null)).toBe(true);

    await worker.close();
    await workerConnection.quit();
    await queueService.onModuleDestroy();
    await jobStateService.onModuleDestroy();
  }, 45_000);
});
