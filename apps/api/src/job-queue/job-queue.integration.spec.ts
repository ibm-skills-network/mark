import { Logger } from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import { decryptJobPayload } from "./job-payload.crypto";
import { JobQueueService } from "./job-queue.service";
import { JobStateService } from "./job-state.service";
import {
  createRedisTestHarness,
  getRedisTestEnvironmentAvailability,
  isRedisTestEnvironmentAvailable,
  RedisTestHarness,
  waitForCondition,
} from "../../../../test-support/redis-test-harness";

const redisTestEnvironment = getRedisTestEnvironmentAvailability();
const describeIntegration = isRedisTestEnvironmentAvailable()
  ? describe
  : describe.skip;

describeIntegration("job-queue integration", () => {
  const jobQueueSecretEnv = "JOB_QUEUE_SECRET"; // pragma: allowlist secret
  const originalRedisUrl = process.env.REDIS_URL;
  const originalQueueKeyValue = process.env[jobQueueSecretEnv];

  let redisHarness: RedisTestHarness | undefined;
  let loggerSpy: jest.SpyInstance | undefined;

  beforeAll(async () => {
    redisHarness = await createRedisTestHarness();
    process.env.REDIS_URL = redisHarness.redisUrl;
    process.env[jobQueueSecretEnv] = "integration-secret";
    loggerSpy = jest
      .spyOn(Logger.prototype, "log")
      .mockImplementation(() => undefined);
  }, 60_000);

  beforeEach(async () => {
    if (!redisHarness) {
      throw new Error(
        `Redis test harness was not initialized: ${redisTestEnvironment.reason ?? "unknown reason"}`,
      );
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

  it("encrypts queued payloads and processes them end to end through BullMQ and Redis job state", async () => {
    const queueName = "mark.job-queue.integration";
    const queueService = new JobQueueService();
    const jobStateService = new JobStateService();
    const inspectorConnection = redisHarness.createClient();
    const inspectorQueue = new Queue(queueName, {
      connection: inspectorConnection,
    });

    const trackedJob = await jobStateService.createJob({
      queueName,
      jobName: "integration.process",
      kind: "integration",
      assignmentId: 42,
      userId: "author-1",
      status: "Pending",
      progress: "Queued",
      activeKey: "assignment:42:user:author-1",
    });

    const payload = {
      jobId: trackedJob.id,
      assignmentId: 42,
      plaintextSentinel: "do-not-leak",
    };

    await queueService.enqueue(queueName, "integration.process", payload);

    const waitingJobs = await inspectorQueue.getWaiting();
    expect(waitingJobs).toHaveLength(1);
    expect(waitingJobs[0].data).toMatchObject({
      version: "v1",
      algorithm: "aes-256-gcm",
    });
    expect(JSON.stringify(waitingJobs[0].data)).not.toContain("do-not-leak");

    const workerConnection = redisHarness.createClient();
    const worker = new Worker(
      queueName,
      async (job) => {
        const decryptedPayload = decryptJobPayload<typeof payload>(job.data);
        expect(decryptedPayload).toEqual(payload);

        await jobStateService.updateJobStatus(decryptedPayload.jobId, {
          status: "Processing",
          progress: "Working",
          percentage: 50,
        });
        await jobStateService.updateJobStatus(decryptedPayload.jobId, {
          status: "Completed",
          progress: "Done",
          percentage: 100,
          result: { ok: true, assignmentId: decryptedPayload.assignmentId },
        });
      },
      {
        connection: workerConnection,
        concurrency: 1,
      },
    );

    const workerCompleted = new Promise<void>((resolve, reject) => {
      worker.on("completed", () => {
        resolve();
      });
      worker.on("failed", (_job, error) => {
        reject(error);
      });
    });

    await workerCompleted;
    await waitForCondition(async () => {
      const currentJob = await jobStateService.getJob(trackedJob.id);
      return currentJob?.status === "Completed";
    });

    await expect(
      jobStateService.findActiveJob("assignment:42:user:author-1"),
    ).resolves.toBeNull();
    await expect(jobStateService.getJob(trackedJob.id)).resolves.toMatchObject({
      id: trackedJob.id,
      status: "Completed",
      progress: "Done",
      percentage: 100,
      result: { ok: true, assignmentId: 42 },
    });

    await worker.close();
    await workerConnection.quit();
    await inspectorQueue.close();
    await inspectorConnection.quit();
    await queueService.onModuleDestroy();
    await jobStateService.onModuleDestroy();
  });

  it("streams Redis-backed status updates and completes after a terminal event", async () => {
    const jobStateService = new JobStateService();
    const trackedJob = await jobStateService.createJob({
      queueName: "mark.job-queue.stream",
      jobName: "integration.stream",
      kind: "integration",
      userId: "learner-1",
      status: "Pending",
      progress: "Queued",
    });

    const events: MessageEvent[] = [];
    const streamCompleted = new Promise<void>((resolve, reject) => {
      const subscription = jobStateService
        .getJobStatusStream(trackedJob.id)
        .subscribe({
          next: (event) => {
            events.push(event);
          },
          error: reject,
          complete: () => {
            subscription.unsubscribe();
            resolve();
          },
        });
    });

    await waitForCondition(() => events.length >= 1);
    await jobStateService.updateJobStatus(trackedJob.id, {
      status: "Processing",
      progress: "Working",
      percentage: 55,
    });
    await jobStateService.updateJobStatus(trackedJob.id, {
      status: "Completed",
      progress: "Done",
      percentage: 100,
      result: { score: 88 },
    });

    await streamCompleted;

    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["update", "finalize"]),
    );

    const finalEvent = events.find((event) => event.type === "finalize");
    expect(JSON.parse(finalEvent?.data ?? "{}")).toMatchObject({
      jobId: trackedJob.id,
      status: "Completed",
      done: true,
      percentage: 100,
      result: JSON.stringify({ score: 88 }),
    });

    await jobStateService.onModuleDestroy();
  });
});

if (!redisTestEnvironment.available) {
  // eslint-disable-next-line no-console
  console.warn(
    `[job-queue integration] skipped: ${redisTestEnvironment.reason ?? "Redis test environment unavailable"}`,
  );
}
