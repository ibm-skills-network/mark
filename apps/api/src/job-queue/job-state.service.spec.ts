import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { JobStateService } from "./job-state.service";
import { createRedisConnection } from "./redis.connection";

jest.mock("./redis.connection", () => ({
  createRedisConnection: jest.fn(),
}));

type RedisHash = Record<string, string>;

class FakeRedisSubscription extends EventEmitter {
  public readonly channels = new Set<string>();
  public readonly unsubscribe = jest.fn(async (channel?: string) => {
    if (channel) {
      this.channels.delete(channel);
    } else {
      this.channels.clear();
    }
  });
  public readonly quit = jest.fn(async () => undefined);

  async subscribe(channel: string): Promise<number> {
    this.channels.add(channel);
    return this.channels.size;
  }
}

class FakeRedis {
  public readonly hashes = new Map<string, RedisHash>();
  public readonly strings = new Map<string, string>();
  public readonly ttls = new Map<string, number>();
  public readonly subscriptions = new Set<FakeRedisSubscription>();
  public readonly quit = jest.fn(async () => undefined);

  multi() {
    const commands: Array<() => Promise<void>> = [];

    const transaction = {
      hset: (key: string, value: RedisHash) => {
        commands.push(async () => {
          const existing = this.hashes.get(key) ?? {};
          this.hashes.set(key, { ...existing, ...value });
        });
        return transaction;
      },
      expire: (key: string, ttlSeconds: number) => {
        commands.push(async () => {
          this.ttls.set(key, ttlSeconds);
        });
        return transaction;
      },
      set: (key: string, value: string, _mode?: "EX", ttlSeconds?: number) => {
        commands.push(async () => {
          this.strings.set(key, value);
          if (ttlSeconds !== undefined) {
            this.ttls.set(key, ttlSeconds);
          }
        });
        return transaction;
      },
      del: (key: string) => {
        commands.push(async () => {
          this.strings.delete(key);
          this.hashes.delete(key);
          this.ttls.delete(key);
        });
        return transaction;
      },
      exec: async () => {
        for (const command of commands) {
          await command();
        }

        return [];
      },
    };

    return transaction;
  }

  async hgetall(key: string): Promise<RedisHash> {
    return { ...(this.hashes.get(key) ?? {}) };
  }

  async get(key: string): Promise<string | null> {
    return this.strings.get(key) ?? null;
  }

  async set(
    key: string,
    value: string,
    exMode?: "EX",
    ttlSeconds?: number,
    nxFlag?: "NX",
  ): Promise<string | null> {
    const isNx = nxFlag === "NX";
    if (isNx && this.strings.has(key)) {
      return null; // NX: key already exists
    }
    this.strings.set(key, value);
    if (exMode === "EX" && ttlSeconds !== undefined) {
      this.ttls.set(key, ttlSeconds);
    }
    return "OK";
  }

  async del(key: string): Promise<number> {
    const existed = this.strings.delete(key) || this.hashes.delete(key);
    this.ttls.delete(key);
    return existed ? 1 : 0;
  }

  async publish(channel: string, message: string): Promise<number> {
    let deliveries = 0;

    for (const subscription of this.subscriptions) {
      if (subscription.channels.has(channel)) {
        deliveries += 1;
        subscription.emit("message", channel, message);
      }
    }

    return deliveries;
  }

  duplicate(): FakeRedisSubscription {
    const subscription = new FakeRedisSubscription();
    this.subscriptions.add(subscription);

    subscription.quit.mockImplementation(async () => {
      this.subscriptions.delete(subscription);
    });

    return subscription;
  }
}

function flushAsyncWork() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function flushMicrotasks() {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

function hashActiveKey(activeKey: string) {
  return createHash("sha256").update(activeKey).digest("hex");
}

describe("JobStateService", () => {
  let fakeRedis: FakeRedis;
  let service: JobStateService;

  beforeEach(() => {
    jest.clearAllMocks();
    fakeRedis = new FakeRedis();
    (createRedisConnection as jest.Mock).mockReturnValue(fakeRedis);
    service = new JobStateService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("creates jobs in Redis and stores the active job mapping without exposing it publicly", async () => {
    const job = await service.createJob({
      queueName: "mark.assignment.v2",
      jobName: "assignment-v2.publish",
      kind: "assignment-publish",
      assignmentId: 42,
      attemptId: null,
      userId: "author-1",
      status: "Pending",
      progress: "Queued",
      percentage: 12.6,
      result: { queued: true },
      activeKey: "assignment:42:user:author-1",
    });

    expect(job).toMatchObject({
      queueName: "mark.assignment.v2",
      jobName: "assignment-v2.publish",
      kind: "assignment-publish",
      assignmentId: 42,
      attemptId: null,
      userId: "author-1",
      status: "Pending",
      progress: "Queued",
      percentage: 13,
      result: { queued: true },
    });

    const storedJob = fakeRedis.hashes.get(`mark:jobs:state:${job.id}`);
    expect(storedJob).toMatchObject({
      assignmentId: "42",
      attemptId: "__null__",
      percentage: "13",
      activeKeyHash: hashActiveKey("assignment:42:user:author-1"),
    });
    expect(
      fakeRedis.strings.get(
        `mark:jobs:active:${hashActiveKey("assignment:42:user:author-1")}`,
      ),
    ).toBe(job.id);
    expect(fakeRedis.ttls.get(`mark:jobs:state:${job.id}`)).toBe(24 * 60 * 60);
    expect(job).not.toHaveProperty("activeKeyHash");
  });

  it("returns active jobs and clears stale mappings when the backing state is missing", async () => {
    const activeKey = "assignment:9:user:author-9";
    const activeJob = await service.createJob({
      queueName: "queue",
      jobName: "job",
      kind: "kind",
      assignmentId: 9,
      userId: "author-9",
      status: "In Progress",
      progress: "Working",
      activeKey,
    });
    const activeRedisKey = `mark:jobs:active:${hashActiveKey(activeKey)}`;

    expect(await service.findActiveJob(activeKey)).toEqual(activeJob);

    fakeRedis.hashes.delete(`mark:jobs:state:${activeJob.id}`);

    await expect(service.findActiveJob(activeKey)).resolves.toBeNull();
    expect(fakeRedis.strings.has(activeRedisKey)).toBe(false);
  });

  it("updates job status, clamps percentage, preserves previous progress when blank, and clears the active key on terminal states", async () => {
    const activeKey = "assignment:2:user:author-2";
    const job = await service.createJob({
      queueName: "queue",
      jobName: "job",
      kind: "kind",
      userId: "author-2",
      status: "Pending",
      progress: "Queued",
      activeKey,
    });

    const publishedMessages: string[] = [];
    const originalPublish = fakeRedis.publish.bind(fakeRedis);
    jest
      .spyOn(fakeRedis, "publish")
      .mockImplementation(async (channel: string, message: string) => {
        publishedMessages.push(`${channel}:${message}`);
        return originalPublish(channel, message);
      });

    const updatedJob = await service.updateJobStatus(job.id, {
      status: "Completed",
      progress: "",
      percentage: 143.2,
      result: { ok: true },
    });

    expect(updatedJob).toMatchObject({
      id: job.id,
      status: "Completed",
      progress: "Queued",
      percentage: 100,
      result: { ok: true },
    });
    expect(fakeRedis.ttls.get(`mark:jobs:state:${job.id}`)).toBe(2 * 60 * 60);
    expect(
      fakeRedis.strings.has(`mark:jobs:active:${hashActiveKey(activeKey)}`),
    ).toBe(false);
    expect(publishedMessages).toHaveLength(1);
    expect(publishedMessages[0]).toContain(`mark:jobs:events:${job.id}`);
    expect(publishedMessages[0]).toContain('"status":"Completed"');
  });

  it("rejects status updates for missing jobs", async () => {
    await expect(
      service.updateJobStatus("missing-job", {
        status: "Completed",
        progress: "Done",
      }),
    ).rejects.toThrow("Job missing-job not found");
  });

  it("emits current state, heartbeat events, and terminal completion over the job stream", async () => {
    jest.useFakeTimers();

    const job = await service.createJob({
      queueName: "queue",
      jobName: "job",
      kind: "kind",
      userId: "learner-1",
      status: "Pending",
      progress: "Queued",
      percentage: 0,
    });

    const events: MessageEvent[] = [];
    let completed = false;

    const subscription = service.getJobStatusStream(job.id).subscribe({
      next: (event) => {
        events.push(event);
      },
      complete: () => {
        completed = true;
      },
    });

    await flushMicrotasks();

    expect(events[0]).toMatchObject({
      type: "update",
    });

    jest.advanceTimersByTime(10_000);
    await flushMicrotasks();

    expect(events.some((event) => event.type === "heartbeat")).toBe(true);

    await service.updateJobStatus(job.id, {
      status: "Completed",
      progress: "Done",
      percentage: 100,
      result: { score: 91 },
    });

    await flushMicrotasks();
    jest.advanceTimersByTime(100);
    await flushMicrotasks();

    const finalEvent = events.at(-1);
    expect(finalEvent).toMatchObject({
      type: "finalize",
    });
    expect(JSON.parse(finalEvent?.data ?? "{}")).toMatchObject({
      jobId: job.id,
      status: "Completed",
      done: true,
      percentage: 100,
      result: JSON.stringify({ score: 91 }),
    });
    expect(completed).toBe(true);

    subscription.unsubscribe();
  });

  it("surfaces invalid pubsub payloads to stream subscribers", async () => {
    const job = await service.createJob({
      queueName: "queue",
      jobName: "job",
      kind: "kind",
      userId: "user-1",
      status: "Pending",
      progress: "Queued",
    });

    const errors: Error[] = [];
    const subscription = service.getJobStatusStream(job.id).subscribe({
      error: (error: Error) => {
        errors.push(error);
      },
    });

    await flushAsyncWork();
    await fakeRedis.publish(`mark:jobs:events:${job.id}`, "not-json");
    await flushAsyncWork();

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("Invalid job event payload");

    subscription.unsubscribe();
  });

  it("errors job streams for unknown job identifiers", async () => {
    const errors: Error[] = [];

    const subscription = service.getJobStatusStream("missing-job").subscribe({
      error: (error: Error) => {
        errors.push(error);
      },
    });

    await flushAsyncWork();

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("Job missing-job not found.");

    subscription.unsubscribe();
  });

  // ─── Change 1: acquireActiveJobLock ──────────────────────────────────────

  it("acquireActiveJobLock returns null and stores the temp id when the key is free", async () => {
    const activeKey = "grading:user-1:assignment-5:attempt-10";
    const tempId = "temp-uuid-abc";

    const existingJobId = await service.acquireActiveJobLock(activeKey, tempId);

    expect(existingJobId).toBeNull();
    const activeKeyHash = hashActiveKey(activeKey);
    expect(fakeRedis.strings.get(`mark:jobs:active:${activeKeyHash}`)).toBe(
      tempId,
    );
    expect(fakeRedis.ttls.get(`mark:jobs:active:${activeKeyHash}`)).toBe(
      24 * 60 * 60,
    );
  });

  it("acquireActiveJobLock returns the existing jobId when the lock is already held", async () => {
    const activeKey = "grading:user-2:assignment-5:attempt-20";
    const firstTempId = "first-temp-uuid";
    const secondTempId = "second-temp-uuid";

    // First caller acquires the lock
    const first = await service.acquireActiveJobLock(activeKey, firstTempId);
    expect(first).toBeNull();

    // Second caller — lock already held
    const second = await service.acquireActiveJobLock(activeKey, secondTempId);
    expect(second).toBe(firstTempId);
  });

  it("createJob with reservedId skips setting the active key pointer again", async () => {
    const activeKey = "grading:user-3:assignment-7:attempt-30";
    const tempId = "reserved-uuid";
    const activeKeyHash = hashActiveKey(activeKey);
    const activeRedisKey = `mark:jobs:active:${activeKeyHash}`;

    // Simulate: acquireActiveJobLock already set the pointer
    await service.acquireActiveJobLock(activeKey, tempId);
    const ptrBefore = fakeRedis.strings.get(activeRedisKey);

    const job = await service.createJob({
      queueName: "mark.attempt",
      jobName: "attempt-grade",
      kind: "attempt-grading",
      assignmentId: 7,
      attemptId: 30,
      userId: "user-3",
      status: "Pending",
      progress: "Queued",
      activeKey,
      reservedId: tempId,
    });

    // Job id equals the reserved id
    expect(job.id).toBe(tempId);
    // Active key pointer must NOT have been overwritten
    expect(fakeRedis.strings.get(activeRedisKey)).toBe(ptrBefore);
  });

  it("createJob without reservedId sets the active key pointer normally", async () => {
    const activeKey = "grading:user-4:assignment-9:attempt-40";
    const activeKeyHash = hashActiveKey(activeKey);

    const job = await service.createJob({
      queueName: "mark.attempt",
      jobName: "attempt-grade",
      kind: "attempt-grading",
      assignmentId: 9,
      attemptId: 40,
      userId: "user-4",
      status: "Pending",
      progress: "Queued",
      activeKey,
    });

    expect(fakeRedis.strings.get(`mark:jobs:active:${activeKeyHash}`)).toBe(
      job.id,
    );
  });

  it("quits the shared Redis connection during module teardown", async () => {
    await service.createJob({
      queueName: "queue",
      jobName: "job",
      kind: "kind",
      userId: "user-1",
      status: "Pending",
      progress: "Queued",
    });

    await service.onModuleDestroy();

    expect(fakeRedis.quit).toHaveBeenCalledTimes(1);
  });
});
