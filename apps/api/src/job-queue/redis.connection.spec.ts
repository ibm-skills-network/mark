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

  beforeEach(() => {
    process.env.REDIS_URL = "redis://localhost:6379";
    MockedIORedis.mockClear();
  });

  afterAll(() => {
    process.env.REDIS_URL = originalRedisUrl;
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
