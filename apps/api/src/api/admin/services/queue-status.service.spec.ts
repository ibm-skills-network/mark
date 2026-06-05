import { encryptJobPayload } from "../../../job-queue/job-payload.crypto";
import { QueueStatusService } from "./queue-status.service";

const makeJob = (over: Record<string, unknown>) => ({
  id: "9",
  name: "attempt.grade",
  attemptsMade: 1,
  opts: { attempts: 3 },
  failedReason: "boom",
  timestamp: 1_700_000_000_000,
  processedOn: 1_700_000_001_000,
  finishedOn: 1_700_000_002_000,
  stacktrace: ["Error: boom\n  at x", "  at y"],
  data: {},
  ...over,
});

const jobQueue = {
  getQueueCounts: jest.fn(),
  getFailedJobs: jest.fn(),
  getActiveJobs: jest.fn(),
  getThroughputSample: jest.fn(),
  isQueuePaused: jest.fn(),
  getRedisInfo: jest.fn(),
  getQueueWorkerConnections: jest.fn(),
  retryFailedJob: jest.fn(),
  removeFailedJob: jest.fn(),
};
const workerConn = { getAllWorkerHeartbeats: jest.fn() };
const s3 = { getSignedUrl: jest.fn() };

const make = () =>
  new QueueStatusService(jobQueue as never, workerConn as never, s3 as never);

const emptySample = { completed: [], failed: [] };

describe("QueueStatusService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jobQueue.isQueuePaused.mockResolvedValue(false);
    jobQueue.getThroughputSample.mockResolvedValue(emptySample);
    workerConn.getAllWorkerHeartbeats.mockResolvedValue([]);
  });

  it("aggregates queue counts and flags a failing queue as unavailable", async () => {
    jobQueue.getQueueCounts.mockImplementation(async (name: string) => {
      if (name === "mark.attempt") throw new Error("redis down");
      return {
        waiting: 1,
        active: 0,
        delayed: 0,
        failed: 0,
        completed: 0,
        paused: 0,
      };
    });
    const queues = await make().getQueueStats();
    const attempt = queues.find((q) => q.name === "mark.attempt");
    expect(attempt?.unavailable).toBe(true);
    expect(attempt?.throughput).toBeNull();
    expect(queues.every((q) => typeof q.waiting === "number")).toBe(true);
  });

  it("populates role + capacity from heartbeats (concurrencyByQueue wins)", async () => {
    const now = Date.now();
    jobQueue.getQueueCounts.mockResolvedValue({
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
      completed: 0,
      paused: 0,
    });
    workerConn.getAllWorkerHeartbeats.mockResolvedValue([
      {
        instanceId: "pod-a",
        queues: ["mark.attempt"],
        updatedAt: new Date(now - 1_000).toISOString(),
        concurrencyByQueue: { "mark.attempt": 6 },
      },
      {
        instanceId: "pod-b",
        queues: ["mark.attempt"],
        updatedAt: new Date(now - 1_000).toISOString(),
        concurrencyByQueue: { "mark.attempt": 6 },
      },
    ]);
    const queues = await make().getQueueStats();
    const attempt = queues.find((q) => q.name === "mark.attempt");
    expect(attempt?.role).toBe("learner");
    expect(attempt?.concurrencyPerPod).toBe(6);
    expect(attempt?.livePods).toBe(2);
    expect(attempt?.clusterCapacity).toBe(12);
  });

  it("falls back to metadata concurrency when heartbeat omits it", async () => {
    const now = Date.now();
    jobQueue.getQueueCounts.mockResolvedValue({
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
      completed: 0,
      paused: 0,
    });
    workerConn.getAllWorkerHeartbeats.mockResolvedValue([
      {
        instanceId: "old-pod",
        queues: ["mark.assignment.v2.translations"],
        updatedAt: new Date(now - 1_000).toISOString(),
      },
    ]);
    const queues = await make().getQueueStats();
    const translations = queues.find(
      (q) => q.name === "mark.assignment.v2.translations",
    );
    expect(translations?.concurrencyPerPod).toBe(8);
    expect(translations?.livePods).toBe(1);
    expect(translations?.clusterCapacity).toBe(8);
  });

  it("does not count stale heartbeats as live pods", async () => {
    const now = Date.now();
    jobQueue.getQueueCounts.mockResolvedValue({
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
      completed: 0,
      paused: 0,
    });
    workerConn.getAllWorkerHeartbeats.mockResolvedValue([
      {
        instanceId: "stale",
        queues: ["mark.attempt"],
        updatedAt: new Date(now - 60_000).toISOString(),
        concurrencyByQueue: { "mark.attempt": 4 },
      },
    ]);
    const queues = await make().getQueueStats();
    const attempt = queues.find((q) => q.name === "mark.attempt");
    expect(attempt?.livePods).toBe(0);
    expect(attempt?.clusterCapacity).toBe(0);
  });

  it("computes throughput per minute and average wait/run", async () => {
    const now = Date.now();
    jobQueue.getQueueCounts.mockResolvedValue({
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
      completed: 0,
      paused: 0,
    });
    jobQueue.getThroughputSample.mockImplementation(async (name: string) => {
      if (name !== "mark.attempt") return emptySample;
      return {
        completed: [
          // In the last minute: wait 1000ms, run 2000ms.
          {
            timestamp: now - 5_000,
            processedOn: now - 4_000,
            finishedOn: now - 2_000,
          },
          // Older than a minute — excluded from per-min, included in averages.
          {
            timestamp: now - 200_000,
            processedOn: now - 199_000,
            finishedOn: now - 196_000,
          },
        ],
        failed: [{ finishedOn: now - 3_000 }, { finishedOn: now - 500_000 }],
      };
    });
    const queues = await make().getQueueStats();
    const attempt = queues.find((q) => q.name === "mark.attempt");
    expect(attempt?.throughput?.completedPerMin).toBe(1);
    expect(attempt?.throughput?.failedPerMin).toBe(1);
    // Waits: 1000 and 1000 -> mean 1000. Runs: 2000 and 3000 -> mean 2500.
    expect(attempt?.throughput?.avgWaitMs).toBe(1000);
    expect(attempt?.throughput?.avgRunMs).toBe(2500);
  });

  it("getFailedJobs rejects an unknown queue name", async () => {
    await expect(make().getFailedJobs("bogus.queue", 25)).rejects.toThrow();
  });

  it("clamps limit and maps fields, whitelisting domain IDs (never userId)", async () => {
    jobQueue.getFailedJobs.mockResolvedValue([
      makeJob({
        data: encryptJobPayload({
          assignmentId: 5,
          attemptId: 7,
          userId: "a@b.com",
        }),
      }),
    ]);
    const out = await make().getFailedJobs("mark.attempt", 9999);
    expect(jobQueue.getFailedJobs).toHaveBeenCalledWith("mark.attempt", 100);
    expect(out[0]).toMatchObject({
      id: "9",
      name: "attempt.grade",
      attemptsMade: 1,
      maxAttempts: 3,
      failedReason: "boom",
    });
    expect(out[0].enqueuedAt).not.toBeNull();
    expect(out[0].processedAt).not.toBeNull();
    expect(out[0].finishedAt).not.toBeNull();
    expect(out[0].stacktrace.length).toBe(2);
    expect(out[0].domainIds).toEqual({ assignmentId: 5, attemptId: 7 });
    expect(out[0].domainIds).not.toHaveProperty("userId");
    // No userId field leaks anywhere on the serialized DTO.
    expect(JSON.stringify(out[0])).not.toContain("a@b.com");
  });

  it("enriches file refs with a presigned downloadUrl", async () => {
    s3.getSignedUrl.mockResolvedValue("https://signed.example/get");
    jobQueue.getFailedJobs.mockResolvedValue([
      makeJob({
        data: encryptJobPayload({
          files: [
            {
              filename: "essay.pdf",
              mimeType: "application/pdf",
              size: 1234,
              storageKey: "k/essay.pdf",
              storageBucket: "learner-bucket",
            },
          ],
        }),
      }),
    ]);
    const out = await make().getFailedJobs("mark.attempt", 5);
    expect(s3.getSignedUrl).toHaveBeenCalledWith("getObject", {
      Bucket: "learner-bucket",
      Key: "k/essay.pdf",
      Expires: 600,
    });
    expect(out[0].files[0]).toMatchObject({
      filename: "essay.pdf",
      bucket: "learner-bucket",
      storageKey: "k/essay.pdf",
      downloadUrl: "https://signed.example/get",
    });
  });

  it("degrades a file ref to downloadUrl:null when presign fails", async () => {
    s3.getSignedUrl.mockRejectedValue(new Error("cos unreachable"));
    jobQueue.getFailedJobs.mockResolvedValue([
      makeJob({
        data: encryptJobPayload({
          files: [
            {
              filename: "essay.pdf",
              storageKey: "k/essay.pdf",
              storageBucket: "learner-bucket",
            },
          ],
        }),
      }),
    ]);
    const out = await make().getFailedJobs("mark.attempt", 5);
    expect(out[0].files[0].downloadUrl).toBeNull();
    expect(out[0].files[0].filename).toBe("essay.pdf");
  });

  it("survives a decrypt failure (job returned with empty domainIds + no files)", async () => {
    jobQueue.getFailedJobs.mockResolvedValue([
      makeJob({
        data: {
          version: "v1",
          algorithm: "aes-256-gcm",
          encryptedPayload: "!!!",
        },
      }),
    ]);
    const out = await make().getFailedJobs("mark.attempt", 5);
    expect(out[0].domainIds).toEqual({});
    expect(out[0].files).toEqual([]);
  });

  it("getActiveJobs maps running-for/processedBy and rejects unknown queue", async () => {
    const now = Date.now();
    jobQueue.getActiveJobs.mockResolvedValue([
      makeJob({
        processedOn: now - 3_000,
        finishedOn: undefined,
        processedBy: "worker-host:42",
        progress: 50,
        data: encryptJobPayload({ assignmentId: 1, userId: "x@y.com" }),
      }),
    ]);
    const out = await make().getActiveJobs("mark.attempt", 25);
    expect(out[0].processedBy).toBe("worker-host:42");
    expect(out[0].progress).toBe(50);
    expect(out[0].runningForMs).toBeGreaterThanOrEqual(3_000);
    expect(out[0].domainIds).toEqual({ assignmentId: 1 });
    expect(JSON.stringify(out[0])).not.toContain("x@y.com");
    await expect(make().getActiveJobs("nope", 25)).rejects.toThrow();
  });

  it("retry/remove reject an unknown queue and delegate otherwise", async () => {
    jobQueue.retryFailedJob.mockResolvedValue(true);
    jobQueue.removeFailedJob.mockResolvedValue(false);
    await expect(make().retryFailedJob("nope", "1")).rejects.toThrow();
    await expect(make().removeFailedJob("nope", "1")).rejects.toThrow();
    expect(await make().retryFailedJob("mark.attempt", "1")).toBe(true);
    expect(await make().removeFailedJob("mark.attempt", "1")).toBe(false);
  });

  it("getRedisHealth reconciles worker connections against live pods", async () => {
    const now = Date.now();
    workerConn.getAllWorkerHeartbeats.mockResolvedValue([
      {
        instanceId: "p1",
        queues: ["mark.attempt"],
        updatedAt: new Date(now - 1_000).toISOString(),
      },
      {
        instanceId: "p2",
        queues: ["mark.attempt"],
        updatedAt: new Date(now - 1_000).toISOString(),
      },
    ]);
    jobQueue.getRedisInfo.mockResolvedValue({
      usedMemoryBytes: 100,
      usedMemoryHuman: "100B",
      connectedClients: 3,
      opsPerSec: 1,
    });
    jobQueue.getQueueWorkerConnections.mockResolvedValue(2);
    const health = await make().getRedisHealth();
    expect(health.heartbeatPods).toBe(2);
    expect(health.workerConnections).toBe(2);
    expect(health.reconciled).toBe(true);
  });
});
