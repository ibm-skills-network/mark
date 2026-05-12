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

jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: queueAdd,
    close: queueClose,
    getJob: queueGetJob,
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
        removeOnComplete: 1000,
        removeOnFail: 1000,
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
});
