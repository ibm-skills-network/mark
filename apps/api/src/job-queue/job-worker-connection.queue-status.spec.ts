const scan = jest.fn();
const get = jest.fn();
const smembers = jest.fn();
const srem = jest.fn();
jest.mock("./redis.connection", () => ({
  createRedisConnection: () => ({
    scan,
    get,
    smembers,
    srem,
    quit: jest.fn().mockResolvedValue(undefined),
  }),
}));

import { JobWorkerConnectionService } from "./job-worker-connection.service";
import {
  DEFAULT_JOB_WORKER_CONNECT_RETRY_DELAY_MS,
  DEFAULT_JOB_WORKER_CONNECTED_CHECK_INTERVAL_MS,
  JOB_WORKER_HEARTBEAT_INDEX_KEY,
} from "./job-worker-heartbeat.constants";

const heartbeat = (instanceId: string) =>
  JSON.stringify({
    instanceId,
    hostname: "h",
    startedAt: "2026-06-03T00:00:00Z",
  });

describe("JobWorkerConnectionService.getAllWorkerHeartbeats", () => {
  let service: JobWorkerConnectionService;
  beforeEach(() => {
    jest.clearAllMocks();
    smembers.mockResolvedValue([]);
    srem.mockResolvedValue(1);
    service = new JobWorkerConnectionService();
  });

  it("lists keys from the heartbeat index without scanning", async () => {
    smembers.mockResolvedValue(["k1", "k2"]);
    get.mockResolvedValueOnce(heartbeat("a"));
    get.mockResolvedValueOnce(heartbeat("b"));
    const result = await service.getAllWorkerHeartbeats();
    expect(result.map((hb) => hb.instanceId)).toEqual(["a", "b"]);
    expect(smembers).toHaveBeenCalledWith(JOB_WORKER_HEARTBEAT_INDEX_KEY);
    expect(scan).not.toHaveBeenCalled();
  });

  it("prunes an index member whose heartbeat key has expired", async () => {
    smembers.mockResolvedValue(["k1", "k-dead"]);
    get.mockResolvedValueOnce(heartbeat("a"));
    get.mockResolvedValueOnce(null);
    const result = await service.getAllWorkerHeartbeats();
    expect(result).toHaveLength(1);
    expect(srem).toHaveBeenCalledWith(JOB_WORKER_HEARTBEAT_INDEX_KEY, "k-dead");
    expect(srem).toHaveBeenCalledTimes(1);
  });

  it("falls back to a keyspace scan only while the index is empty", async () => {
    smembers.mockResolvedValue([]);
    scan.mockResolvedValueOnce(["0", ["k1", "k2"]]);
    get.mockResolvedValueOnce(heartbeat("a"));
    get.mockResolvedValueOnce("not-json");
    const result = await service.getAllWorkerHeartbeats();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ instanceId: "a", hostname: "h" });
    expect(scan).toHaveBeenCalledTimes(1);
  });
});

describe("JobWorkerConnectionService check cadence", () => {
  let service: JobWorkerConnectionService;
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    srem.mockResolvedValue(1);
    service = new JobWorkerConnectionService();
    jest.spyOn(service["logger"], "log").mockImplementation(() => undefined);
    jest.spyOn(service["logger"], "warn").mockImplementation(() => undefined);
  });
  afterEach(async () => {
    await service.onModuleDestroy();
    jest.useRealTimers();
  });

  it("retries quickly until a worker is seen, then idles between checks", async () => {
    smembers.mockResolvedValue([]);
    scan.mockResolvedValue(["0", []]);
    const timeoutSpy = jest.spyOn(global, "setTimeout");

    service.onApplicationBootstrap();
    await flush();
    expect(timeoutSpy).toHaveBeenLastCalledWith(
      expect.any(Function),
      DEFAULT_JOB_WORKER_CONNECT_RETRY_DELAY_MS,
    );

    smembers.mockResolvedValue(["k1"]);
    get.mockResolvedValue(heartbeat("a"));
    jest.advanceTimersByTime(DEFAULT_JOB_WORKER_CONNECT_RETRY_DELAY_MS);
    await flush();
    expect(timeoutSpy).toHaveBeenLastCalledWith(
      expect.any(Function),
      DEFAULT_JOB_WORKER_CONNECTED_CHECK_INTERVAL_MS,
    );
    expect(scan).toHaveBeenCalledTimes(1);
  });
});

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}
