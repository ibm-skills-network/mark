import IORedis from "ioredis";
import {
  createCacheRedisConnection,
  createRedisConnection,
  isRedisReady,
} from "./redis.connection";

jest.mock("ioredis", () => {
  return jest.fn().mockImplementation((url: string, options: unknown) => ({
    url,
    options,
    status: "wait",
  }));
});

const MockedIORedis = IORedis as unknown as jest.Mock;

describe("redis.connection", () => {
  const originalRedisUrl = process.env.REDIS_URL;

  const originalSentinelHosts = process.env.REDIS_SENTINEL_HOSTS;
  const originalSentinelMaster = process.env.REDIS_SENTINEL_MASTER;

  beforeEach(() => {
    process.env.REDIS_URL = "redis://localhost:6379";
    delete process.env.REDIS_SENTINEL_HOSTS;
    delete process.env.REDIS_SENTINEL_MASTER;
    MockedIORedis.mockClear();
  });

  afterAll(() => {
    process.env.REDIS_URL = originalRedisUrl;
    process.env.REDIS_SENTINEL_HOSTS = originalSentinelHosts;
    process.env.REDIS_SENTINEL_MASTER = originalSentinelMaster;
  });

  describe("createRedisConnection", () => {
    it("keeps the BullMQ-required retry behavior (commands wait for reconnect)", () => {
      createRedisConnection();
      const options = MockedIORedis.mock.calls[0][1];
      expect(options.maxRetriesPerRequest).toBeNull();
    });
  });

  describe("createCacheRedisConnection", () => {
    it("fails fast instead of queueing commands while disconnected", () => {
      createCacheRedisConnection();
      const options = MockedIORedis.mock.calls[0][1];
      expect(options.enableOfflineQueue).toBe(false);
      expect(options.maxRetriesPerRequest).toBe(1);
    });

    it("bounds connect and command latency", () => {
      createCacheRedisConnection();
      const options = MockedIORedis.mock.calls[0][1];
      expect(options.connectTimeout).toBe(2000);
      expect(options.commandTimeout).toBe(500);
    });

    it("throws when REDIS_URL is unset", () => {
      delete process.env.REDIS_URL;
      expect(() => createCacheRedisConnection()).toThrow(/REDIS_URL/);
    });
  });

  describe("sentinel mode", () => {
    beforeEach(() => {
      process.env.REDIS_SENTINEL_HOSTS = "mark-redis:26379,mark-redis-b";
    });

    it("connects through the sentinels instead of REDIS_URL", () => {
      createRedisConnection();
      const [options, second] = MockedIORedis.mock.calls[0];
      expect(second).toBeUndefined();
      expect(options.sentinels).toEqual([
        { host: "mark-redis", port: 26379 },
        { host: "mark-redis-b", port: 26379 },
      ]);
      expect(options.name).toBe("mymaster");
    });

    it("uses REDIS_SENTINEL_MASTER as the monitored master set name", () => {
      process.env.REDIS_SENTINEL_MASTER = "primary";
      createRedisConnection();
      expect(MockedIORedis.mock.calls[0][0].name).toBe("primary");
    });

    it("takes precedence over REDIS_URL when both are set", () => {
      process.env.REDIS_URL = "redis://standalone:6379";
      createRedisConnection();
      const [options] = MockedIORedis.mock.calls[0];
      expect(typeof options).toBe("object");
      expect(options.sentinels).toHaveLength(2);
    });

    it("keeps the BullMQ retry behavior for queue connections", () => {
      createRedisConnection();
      expect(MockedIORedis.mock.calls[0][0].maxRetriesPerRequest).toBeNull();
    });

    it("keeps the fail-fast bounds for cache connections", () => {
      createCacheRedisConnection();
      const [options] = MockedIORedis.mock.calls[0];
      expect(options.sentinels).toHaveLength(2);
      expect(options.enableOfflineQueue).toBe(false);
      expect(options.maxRetriesPerRequest).toBe(1);
      expect(options.connectTimeout).toBe(2000);
      expect(options.commandTimeout).toBe(500);
    });

    it("does not require REDIS_URL", () => {
      delete process.env.REDIS_URL;
      expect(() => createRedisConnection()).not.toThrow();
    });

    it("rejects a hosts list with a malformed port", () => {
      process.env.REDIS_SENTINEL_HOSTS = "mark-redis:abc";
      expect(() => createRedisConnection()).toThrow(/REDIS_SENTINEL_HOSTS/);
    });

    it("rejects an empty hosts list", () => {
      process.env.REDIS_SENTINEL_HOSTS = " , ";
      expect(() => createRedisConnection()).toThrow(/REDIS_SENTINEL_HOSTS/);
    });
  });

  describe("isRedisReady", () => {
    it("is false for an absent client", () => {
      expect(isRedisReady(undefined)).toBe(false);
    });

    it("is false while connecting or reconnecting", () => {
      expect(isRedisReady({ status: "connecting" } as IORedis)).toBe(false);
      expect(isRedisReady({ status: "reconnecting" } as IORedis)).toBe(false);
      expect(isRedisReady({ status: "end" } as IORedis)).toBe(false);
    });

    it("is true only for a ready connection", () => {
      expect(isRedisReady({ status: "ready" } as IORedis)).toBe(true);
    });
  });
});
