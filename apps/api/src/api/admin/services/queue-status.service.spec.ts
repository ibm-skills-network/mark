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
const s3 = { getSignedUrl: jest.fn(), isConfiguredUploadBucket: jest.fn() };

const make = () =>
  new QueueStatusService(jobQueue as never, workerConn as never, s3 as never);

const emptySample = {
  completedPerMin: 0,
  failedPerMin: 0,
  avgSample: [],
};

describe("QueueStatusService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jobQueue.isQueuePaused.mockResolvedValue(false);
    jobQueue.getThroughputSample.mockResolvedValue(emptySample);
    workerConn.getAllWorkerHeartbeats.mockResolvedValue([]);
    // Default: every bucket the tests use is a configured upload bucket. Tests
    // that exercise the foreign-bucket path override this per-case.
    s3.isConfiguredUploadBucket.mockReturnValue(true);
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

  it("sums per-pod concurrency for cluster capacity during a mixed rolling deploy", async () => {
    const now = Date.now();
    jobQueue.getQueueCounts.mockResolvedValue({
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
      completed: 0,
      paused: 0,
    });
    // Rolling deploy: an old pod at concurrency 4 and a new pod at 6. True
    // capacity is 4 + 6 = 10, not max(6) * 2 = 12.
    workerConn.getAllWorkerHeartbeats.mockResolvedValue([
      {
        instanceId: "old-pod",
        queues: ["mark.attempt"],
        updatedAt: new Date(now - 1_000).toISOString(),
        concurrencyByQueue: { "mark.attempt": 4 },
      },
      {
        instanceId: "new-pod",
        queues: ["mark.attempt"],
        updatedAt: new Date(now - 1_000).toISOString(),
        concurrencyByQueue: { "mark.attempt": 6 },
      },
    ]);
    const queues = await make().getQueueStats();
    const attempt = queues.find((q) => q.name === "mark.attempt");
    expect(attempt?.livePods).toBe(2);
    expect(attempt?.clusterCapacity).toBe(10);
    // Representative per-pod value for display is the max published concurrency.
    expect(attempt?.concurrencyPerPod).toBe(6);
  });

  it("sums default concurrency for pods that omit the published value", async () => {
    const now = Date.now();
    jobQueue.getQueueCounts.mockResolvedValue({
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
      completed: 0,
      paused: 0,
    });
    // One pod publishes 6, the other (older) omits it and falls back to the
    // metadata default of 4 for mark.attempt. Capacity = 6 + 4 = 10.
    workerConn.getAllWorkerHeartbeats.mockResolvedValue([
      {
        instanceId: "new-pod",
        queues: ["mark.attempt"],
        updatedAt: new Date(now - 1_000).toISOString(),
        concurrencyByQueue: { "mark.attempt": 6 },
      },
      {
        instanceId: "old-pod",
        queues: ["mark.attempt"],
        updatedAt: new Date(now - 1_000).toISOString(),
      },
    ]);
    const queues = await make().getQueueStats();
    const attempt = queues.find((q) => q.name === "mark.attempt");
    expect(attempt?.livePods).toBe(2);
    expect(attempt?.clusterCapacity).toBe(10);
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

  it("passes through windowed counts and averages the bounded sample", async () => {
    const now = Date.now();
    jobQueue.getQueueCounts.mockResolvedValue({
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
      completed: 0,
      paused: 0,
    });
    // The per-minute counts are now computed by the service layer (via ZCOUNT)
    // and handed to the read-model already windowed; only the wait/run averages
    // are derived here from the small hydrated sample.
    jobQueue.getThroughputSample.mockImplementation(async (name: string) => {
      if (name !== "mark.attempt") return emptySample;
      return {
        completedPerMin: 4,
        failedPerMin: 2,
        avgSample: [
          // wait 1000ms, run 2000ms
          {
            timestamp: now - 5_000,
            processedOn: now - 4_000,
            finishedOn: now - 2_000,
          },
          // wait 1000ms, run 3000ms
          {
            timestamp: now - 200_000,
            processedOn: now - 199_000,
            finishedOn: now - 196_000,
          },
        ],
      };
    });
    const queues = await make().getQueueStats();
    const attempt = queues.find((q) => q.name === "mark.attempt");
    expect(attempt?.throughput?.completedPerMin).toBe(4);
    expect(attempt?.throughput?.failedPerMin).toBe(2);
    // Waits: 1000 and 1000 -> mean 1000. Runs: 2000 and 3000 -> mean 2500.
    expect(attempt?.throughput?.avgWaitMs).toBe(1000);
    expect(attempt?.throughput?.avgRunMs).toBe(2500);
  });

  it("reports null averages when the sample is empty but keeps the counts", async () => {
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
      return { completedPerMin: 7, failedPerMin: 0, avgSample: [] };
    });
    const queues = await make().getQueueStats();
    const attempt = queues.find((q) => q.name === "mark.attempt");
    expect(attempt?.throughput?.completedPerMin).toBe(7);
    expect(attempt?.throughput?.failedPerMin).toBe(0);
    expect(attempt?.throughput?.avgWaitMs).toBeNull();
    expect(attempt?.throughput?.avgRunMs).toBeNull();
  });

  it("uses supplied heartbeats without re-scanning when passed in", async () => {
    const now = Date.now();
    jobQueue.getQueueCounts.mockResolvedValue({
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
      completed: 0,
      paused: 0,
    });
    const heartbeats = [
      {
        instanceId: "pod-a",
        queues: ["mark.attempt"],
        updatedAt: new Date(now - 1_000).toISOString(),
        concurrencyByQueue: { "mark.attempt": 6 },
      },
    ];
    const service = make();
    const stats = await service.getQueueStats(heartbeats as never);
    const workers = await service.getWorkers(heartbeats as never);

    // Neither call re-fetched heartbeats — the caller already supplied them.
    expect(workerConn.getAllWorkerHeartbeats).not.toHaveBeenCalled();
    expect(stats.find((q) => q.name === "mark.attempt")?.livePods).toBe(1);
    expect(workers).toHaveLength(1);
    expect(workers[0].instanceId).toBe("pod-a");
  });

  it("fetches heartbeats itself when none are supplied (back-compat)", async () => {
    jobQueue.getQueueCounts.mockResolvedValue({
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
      completed: 0,
      paused: 0,
    });
    await make().getQueueStats();
    expect(workerConn.getAllWorkerHeartbeats).toHaveBeenCalledTimes(1);
  });

  it("getAllWorkerHeartbeats delegates to the worker-connection service", async () => {
    const hbs = [{ instanceId: "p1" }];
    workerConn.getAllWorkerHeartbeats.mockResolvedValue(hbs);
    const out = await make().getAllWorkerHeartbeats();
    expect(out).toBe(hbs);
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

  it("does not presign a file ref whose bucket is not configured (downloadUrl:null)", async () => {
    // Hostile payload: bucket the app is not configured to use. It must never
    // be turned into a signed URL — degrade to no link without calling S3.
    s3.isConfiguredUploadBucket.mockImplementation(
      (bucket: string) => bucket === "learner-bucket",
    );
    s3.getSignedUrl.mockResolvedValue("https://signed.example/get");
    jobQueue.getFailedJobs.mockResolvedValue([
      makeJob({
        data: encryptJobPayload({
          files: [
            {
              filename: "essay.pdf",
              storageKey: "k/essay.pdf",
              storageBucket: "attacker-controlled-bucket",
            },
          ],
        }),
      }),
    ]);
    const out = await make().getFailedJobs("mark.attempt", 5);
    expect(out[0].files[0].downloadUrl).toBeNull();
    expect(s3.getSignedUrl).not.toHaveBeenCalled();
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

  it("getRedisHealth reconciles per queue: a heavy-only pod does not inflate the pod count against mark.attempt worker connections", async () => {
    const now = Date.now();
    workerConn.getAllWorkerHeartbeats.mockResolvedValue([
      {
        instanceId: "fast-pod",
        queues: [
          "mark.attempt",
          "mark.assignment.v1",
          "mark.assignment.v2",
          "mark.assignment.v2.translations",
          "mark.admin.translation",
        ],
        updatedAt: new Date(now - 1_000).toISOString(),
      },
      {
        // Heavy deployment: consumes only mark.attempt.heavy, so it registers
        // no BullMQ worker on mark.attempt and must not count toward the
        // mark.attempt reconcile.
        instanceId: "heavy-pod",
        queues: ["mark.attempt.heavy"],
        updatedAt: new Date(now - 1_000).toISOString(),
      },
    ]);
    jobQueue.getRedisInfo.mockResolvedValue({
      usedMemoryBytes: 100,
      usedMemoryHuman: "100B",
      connectedClients: 3,
      opsPerSec: 1,
    });
    jobQueue.getQueueWorkerConnections.mockResolvedValue(1);
    const health = await make().getRedisHealth();
    expect(health.heartbeatPods).toBe(1);
    expect(health.workerConnections).toBe(1);
    expect(health.reconciled).toBe(true);
  });

  it("getRedisHealth counts a legacy heartbeat with no queues field as serving the probe queue", async () => {
    const now = Date.now();
    workerConn.getAllWorkerHeartbeats.mockResolvedValue([
      {
        // Pre-tiering pod image: never wrote a `queues` field at all. Legacy
        // pods always consumed every queue, so a missing field must count as
        // "serves mark.attempt" rather than being excluded.
        instanceId: "legacy-pod",
        updatedAt: new Date(now - 1_000).toISOString(),
      },
    ]);
    jobQueue.getRedisInfo.mockResolvedValue({
      usedMemoryBytes: 100,
      usedMemoryHuman: "100B",
      connectedClients: 3,
      opsPerSec: 1,
    });
    jobQueue.getQueueWorkerConnections.mockResolvedValue(1);
    const health = await make().getRedisHealth();
    expect(health.heartbeatPods).toBe(1);
    expect(health.reconciled).toBe(true);
  });
});
