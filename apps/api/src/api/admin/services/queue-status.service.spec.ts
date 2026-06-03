import { encryptJobPayload } from "../../../job-queue/job-payload.crypto";
import { QueueStatusService } from "./queue-status.service";

const makeJob = (over: Record<string, unknown>) => ({
  id: "9",
  name: "attempt.grade",
  attemptsMade: 1,
  opts: { attempts: 3 },
  failedReason: "boom",
  finishedOn: 1_700_000_000_000,
  data: {},
  ...over,
});

const jobQueue = {
  getQueueCounts: jest.fn(),
  getFailedJobs: jest.fn(),
};
const workerConn = { getAllWorkerHeartbeats: jest.fn() };

const make = () =>
  new QueueStatusService(jobQueue as never, workerConn as never);

describe("QueueStatusService", () => {
  beforeEach(() => jest.clearAllMocks());

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
    expect(queues.every((q) => typeof q.waiting === "number")).toBe(true);
  });

  it("computes uptime/lastSeen and flags stale workers", async () => {
    const now = Date.now();
    workerConn.getAllWorkerHeartbeats.mockResolvedValue([
      {
        instanceId: "fresh",
        hostname: "h1",
        pid: 1,
        workerCount: 5,
        queues: ["q"],
        startedAt: new Date(now - 60_000).toISOString(),
        updatedAt: new Date(now - 2_000).toISOString(),
      },
      {
        instanceId: "stale",
        hostname: "h2",
        pid: 2,
        workerCount: 5,
        queues: ["q"],
        startedAt: new Date(now - 60_000).toISOString(),
        updatedAt: new Date(now - 60_000).toISOString(),
      },
    ]);
    const workers = await make().getWorkers();
    expect(workers.find((w) => w.instanceId === "fresh")?.stale).toBe(false);
    expect(workers.find((w) => w.instanceId === "stale")?.stale).toBe(true);
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
    expect(out[0].domainIds).toEqual({ assignmentId: 5, attemptId: 7 });
    expect(out[0].domainIds).not.toHaveProperty("userId");
  });

  it("survives a decrypt failure (job returned with empty domainIds)", async () => {
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
  });
});
