import IORedis from "ioredis";
import {
  createCacheRedisConnection,
  createRedisConnection,
  isRedisReady,
  parseSentinelHosts,
  validateRedisConnectionConfig,
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
    delete process.env.REDIS_SENTINEL_PASSWORD;
    MockedIORedis.mockClear();
  });

  const originalSentinelPassword = process.env.REDIS_SENTINEL_PASSWORD; // pragma: allowlist secret

  const restoreEnvironment = (name: string, value: string | undefined) => {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  };

  afterAll(() => {
    restoreEnvironment("REDIS_URL", originalRedisUrl);
    restoreEnvironment("REDIS_SENTINEL_HOSTS", originalSentinelHosts);
    restoreEnvironment("REDIS_SENTINEL_MASTER", originalSentinelMaster);
    restoreEnvironment("REDIS_SENTINEL_PASSWORD", originalSentinelPassword);
  });

  describe("url mode (REDIS_SENTINEL_HOSTS unset)", () => {
    it("passes REDIS_URL straight to ioredis without sentinel options", () => {
      createRedisConnection();
      const [url, options] = MockedIORedis.mock.calls[0];
      expect(url).toBe("redis://localhost:6379");
      expect(options.sentinels).toBeUndefined();
      expect(options.name).toBeUndefined();
    });

    it("treats a blank REDIS_SENTINEL_HOSTS as unset", () => {
      process.env.REDIS_SENTINEL_HOSTS = "  ";
      createCacheRedisConnection();
      expect(MockedIORedis.mock.calls[0][0]).toBe("redis://localhost:6379");
    });
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

    it("rejects an invalid master name", () => {
      process.env.REDIS_SENTINEL_MASTER = "my master";
      expect(() => createRedisConnection()).toThrow(/REDIS_SENTINEL_MASTER/);
    });

    it("carries REDIS_URL credentials and db index to the master", () => {
      process.env.REDIS_URL = "redis://app:s%40cret@standalone:6379/2"; // pragma: allowlist secret
      createRedisConnection();
      const [options] = MockedIORedis.mock.calls[0];
      expect(options.username).toBe("app");
      expect(options.password).toBe("s@cret");
      expect(options.db).toBe(2);
      expect(options.sentinelPassword).toBe("s@cret");
      expect(options.tls).toBeUndefined();
    });

    it("prefers REDIS_SENTINEL_PASSWORD for sentinel auth", () => {
      process.env.REDIS_URL = "redis://:master-pw@standalone:6379"; // pragma: allowlist secret
      process.env.REDIS_SENTINEL_PASSWORD = "sentinel-pw"; // pragma: allowlist secret
      createCacheRedisConnection();
      const [options] = MockedIORedis.mock.calls[0];
      expect(options.password).toBe("master-pw");
      expect(options.sentinelPassword).toBe("sentinel-pw");
    });

    it("omits auth when REDIS_URL has no password", () => {
      createRedisConnection();
      const [options] = MockedIORedis.mock.calls[0];
      expect(options.password).toBeUndefined();
      expect(options.sentinelPassword).toBeUndefined();
    });

    it("enables TLS to the master for rediss:// URLs", () => {
      process.env.REDIS_URL = "rediss://:pw@standalone:6380"; // pragma: allowlist secret
      createRedisConnection();
      const [options] = MockedIORedis.mock.calls[0];
      expect(options.tls).toEqual({});
      expect(options.enableTLSForSentinelMode).toBe(true);
    });

    it("rejects a malformed REDIS_URL without echoing it", () => {
      process.env.REDIS_URL = "not a url :hunter2";
      expect(() => createRedisConnection()).toThrow(
        "REDIS_URL is not a valid URL",
      );
    });

    it("rejects a non-numeric database index", () => {
      process.env.REDIS_URL = "redis://standalone:6379/abc";
      expect(() => createRedisConnection()).toThrow(/database index/);
    });
  });

  describe("parseSentinelHosts", () => {
    it("parses host and host:port entries, trimming whitespace", () => {
      expect(
        parseSentinelHosts(" a:26380 , b.svc.cluster.local ,10.0.0.1:1"),
      ).toEqual([
        { host: "a", port: 26380 },
        { host: "b.svc.cluster.local", port: 26379 },
        { host: "10.0.0.1", port: 1 },
      ]);
    });

    it.each([
      "redis:0",
      "redis:65536",
      "redis:",
      ":26379",
      "redis:1e3",
      "redis:-1",
      "redis://host:26379",
      "bad host:26379",
      "a,b:x",
    ])("rejects %j", (raw) => {
      expect(() => parseSentinelHosts(raw)).toThrow(/REDIS_SENTINEL_HOSTS/);
    });
  });

  describe("startup logging", () => {
    // Fresh module registry so the once-per-process mode log fires again; the
    // spy must target the Logger class from that same registry.
    const logMessagesFor = (
      run: (connection: typeof import("./redis.connection")) => void,
    ): string[] => {
      const messages: string[] = [];
      jest.isolateModules(() => {
        const nest =
          jest.requireActual<typeof import("@nestjs/common")>("@nestjs/common");
        jest
          .spyOn(nest.Logger.prototype, "log")
          .mockImplementation((message: unknown) => {
            messages.push(String(message));
          });
        run(
          jest.requireActual<typeof import("./redis.connection")>(
            "./redis.connection",
          ),
        );
      });
      return messages;
    };

    it("logs the sentinel mode once without the password", () => {
      process.env.REDIS_SENTINEL_HOSTS = "mark-redis";
      process.env.REDIS_URL = "redis://:top-secret@standalone:6379"; // pragma: allowlist secret
      const messages = logMessagesFor((connection) => {
        connection.createRedisConnection();
        connection.createCacheRedisConnection();
      });
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain("sentinel");
      expect(messages[0]).toContain("mark-redis:26379");
      expect(messages[0]).not.toContain("top-secret");
    });

    it("logs url mode without the URL", () => {
      process.env.REDIS_URL = "redis://:top-secret@standalone:6379"; // pragma: allowlist secret
      const messages = logMessagesFor((connection) => {
        connection.createRedisConnection();
      });
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain("url");
      expect(messages[0]).not.toContain("top-secret");
    });
  });

  describe("validateRedisConnectionConfig", () => {
    it("throws at startup for a malformed sentinel host", () => {
      process.env.REDIS_SENTINEL_HOSTS = "mark-redis:not-a-port";
      expect(() => validateRedisConnectionConfig()).toThrow(
        /REDIS_SENTINEL_HOSTS/,
      );
    });

    it("tolerates a missing REDIS_URL when sentinels are unset", () => {
      delete process.env.REDIS_URL;
      expect(() => validateRedisConnectionConfig()).not.toThrow();
    });

    it("does not open a connection", () => {
      process.env.REDIS_SENTINEL_HOSTS = "mark-redis";
      validateRedisConnectionConfig();
      expect(MockedIORedis).not.toHaveBeenCalled();
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
