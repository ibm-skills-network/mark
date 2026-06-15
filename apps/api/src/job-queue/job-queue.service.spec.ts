import { Logger } from "@nestjs/common";
import { JobsOptions, Queue } from "bullmq";
import { encryptJobPayload } from "./job-payload.crypto";
import { createRedisConnection } from "./redis.connection";
import { JobQueueService } from "./job-queue.service";

jest.mock("./job-payload.crypto", () => ({
  encryptJobPayload: jest.fn(),
}));

const queueAdd = jest.fn();
const queueClose = jest.fn();
const queueGetJob = jest.fn();
const redisZcount = jest.fn();
const redisZrevrangebyscore = jest.fn();
const redisClient = {
  zcount: redisZcount,
  zrevrangebyscore: redisZrevrangebyscore,
};

jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation((name: string) => ({
    add: queueAdd,
    close: queueClose,
    getJob: queueGetJob,
    // Mirror BullMQ's key derivation closely enough for assertions: the
    // completed/failed sorted sets are "<prefix>:<name>:<type>".
    toKey: (type: string) => `bull:${name}:${type}`,
    // BullMQ resolves `queue.client` to the shared ioredis client.
    client: Promise.resolve(redisClient),
  })),
}));

jest.mock("./redis.connection", () => ({
  createRedisConnection: jest.fn(),
}));

describe("JobQueueService", () => {
  const mockConnection = {
    quit: jest.fn(),
  };

  let loggerSpy: jest.SpyInstance;
  let service: JobQueueService;

  beforeEach(() => {
    jest.clearAllMocks();
    loggerSpy = jest
      .spyOn(Logger.prototype, "log")
      .mockImplementation(() => undefined);
    queueAdd.mockResolvedValue(undefined);
    queueClose.mockResolvedValue(undefined);
    queueGetJob.mockResolvedValue(undefined);
    redisZcount.mockResolvedValue(0);
    redisZrevrangebyscore.mockResolvedValue([]);
    mockConnection.quit.mockResolvedValue(undefined);
    (createRedisConnection as jest.Mock).mockReturnValue(mockConnection);
    (encryptJobPayload as jest.Mock).mockImplementation((payload: unknown) => ({
      encrypted: payload,
    }));

    service = new JobQueueService();
  });

  afterEach(() => {
    loggerSpy.mockRestore();
  });

  it("encrypts payloads before enqueueing and forwards job options", async () => {
    const payload = { jobId: "job-1", assignmentId: 77 };
    const options: JobsOptions = { delay: 500, attempts: 6 };

    await service.enqueue("queue-a", "process-job", payload, options);

    expect(encryptJobPayload).toHaveBeenCalledWith(payload);
    expect(Queue).toHaveBeenCalledWith("queue-a", {
      connection: mockConnection,
      defaultJobOptions: {
        attempts: 3,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 },
      },
    });
    expect(queueAdd).toHaveBeenCalledWith(
      "process-job",
      { encrypted: payload },
      options,
    );
  });

  it("reuses the same queue instance for repeated enqueue operations", async () => {
    await service.enqueue("queue-a", "job-1", { id: 1 });
    await service.enqueue("queue-a", "job-2", { id: 2 });
    await service.enqueue("queue-b", "job-3", { id: 3 });

    expect(Queue).toHaveBeenCalledTimes(2);
    expect(createRedisConnection).toHaveBeenCalledTimes(1);
    expect(queueAdd).toHaveBeenCalledTimes(3);
  });

  it("closes every queue and the shared Redis connection on destroy", async () => {
    await service.enqueue("queue-a", "job-1", { id: 1 });
    await service.enqueue("queue-b", "job-2", { id: 2 });

    await service.onModuleDestroy();

    expect(queueClose).toHaveBeenCalledTimes(2);
    expect(mockConnection.quit).toHaveBeenCalledTimes(1);
  });

  it("does not create a Redis connection until the first enqueue", async () => {
    expect(createRedisConnection).not.toHaveBeenCalled();

    await service.enqueue("queue-a", "job-1", { id: 1 });

    expect(createRedisConnection).toHaveBeenCalledTimes(1);
  });

  describe("findActiveJob", () => {
    it("returns null when the queue has no record of the job id", async () => {
      queueGetJob.mockResolvedValueOnce(undefined);

      const result = await service.findActiveJob("queue-a", "publish:v2:1");

      expect(queueGetJob).toHaveBeenCalledWith("publish:v2:1");
      expect(result).toBeNull();
    });

    it("returns the job descriptor when the job is in flight", async () => {
      queueGetJob.mockResolvedValueOnce({
        id: "publish:v2:1",
        getState: jest.fn().mockResolvedValue("active"),
      });

      const result = await service.findActiveJob("queue-a", "publish:v2:1");

      expect(result).toEqual({ id: "publish:v2:1", state: "active" });
    });

    it("returns null when the job is in a terminal state (completed/failed/unknown)", async () => {
      const terminalStates = ["completed", "failed", "unknown"] as const;

      for (const state of terminalStates) {
        queueGetJob.mockResolvedValueOnce({
          id: "publish:v2:1",
          getState: jest.fn().mockResolvedValue(state),
        });

        // eslint-disable-next-line no-await-in-loop
        const result = await service.findActiveJob("queue-a", "publish:v2:1");

        expect(result).toBeNull();
      }
    });

    it("returns the job descriptor for delayed jobs (BullMQ retry backoff)", async () => {
      queueGetJob.mockResolvedValueOnce({
        id: "publish:v2:1",
        getState: jest.fn().mockResolvedValue("delayed"),
      });

      const result = await service.findActiveJob("queue-a", "publish:v2:1");

      expect(result).toEqual({ id: "publish:v2:1", state: "delayed" });
    });
  });

  describe("getThroughputSample", () => {
    it("counts per-minute via ZCOUNT over the completed/failed sorted sets without hydrating jobs", async () => {
      redisZcount.mockImplementation(async (key: string) =>
        key === "bull:queue-a:completed" ? 12 : 3,
      );
      // No completed ids in the window -> no job hydration for averages.
      redisZrevrangebyscore.mockResolvedValue([]);

      const sample = await service.getThroughputSample("queue-a");

      expect(redisZcount).toHaveBeenCalledWith(
        "bull:queue-a:completed",
        expect.any(String),
        "+inf",
      );
      expect(redisZcount).toHaveBeenCalledWith(
        "bull:queue-a:failed",
        expect.any(String),
        "+inf",
      );
      expect(sample.completedPerMin).toBe(12);
      expect(sample.failedPerMin).toBe(3);
      expect(sample.avgSample).toEqual([]);
      // ZCOUNT only: no job hashes hydrated when there are no in-window ids.
      expect(queueGetJob).not.toHaveBeenCalled();
    });

    it("hydrates only the bounded set of recent completed ids for the average sample", async () => {
      redisZcount.mockResolvedValue(5);
      redisZrevrangebyscore.mockResolvedValue(["7", "8"]);
      queueGetJob.mockImplementation(async (id: string) =>
        id === "7"
          ? { timestamp: 1000, processedOn: 1500, finishedOn: 3000 }
          : { timestamp: 2000, processedOn: 2400, finishedOn: 2900 },
      );

      const sample = await service.getThroughputSample("queue-a");

      // Bounded LIMIT 0..20 over the completed set, newest-first within window.
      expect(redisZrevrangebyscore).toHaveBeenCalledWith(
        "bull:queue-a:completed",
        "+inf",
        expect.any(String),
        "LIMIT",
        0,
        20,
      );
      expect(queueGetJob).toHaveBeenCalledTimes(2);
      expect(sample.avgSample).toEqual([
        { timestamp: 1000, processedOn: 1500, finishedOn: 3000 },
        { timestamp: 2000, processedOn: 2400, finishedOn: 2900 },
      ]);
    });

    it("skips an id that aged out between the ZSET read and the hydrate", async () => {
      redisZcount.mockResolvedValue(2);
      redisZrevrangebyscore.mockResolvedValue(["7", "gone"]);
      queueGetJob.mockImplementation(async (id: string) =>
        id === "7"
          ? { timestamp: 1000, processedOn: 1500, finishedOn: 3000 }
          : undefined,
      );

      const sample = await service.getThroughputSample("queue-a");

      expect(sample.avgSample).toEqual([
        { timestamp: 1000, processedOn: 1500, finishedOn: 3000 },
      ]);
    });
  });
});
