import IORedis, { RedisOptions } from "ioredis";

const DEFAULT_SENTINEL_PORT = 26_379;
const DEFAULT_SENTINEL_MASTER = "mymaster";

interface SentinelAddress {
  host: string;
  port: number;
}

export function getRedisUrl(): string {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error(
      "REDIS_URL (or REDIS_SENTINEL_HOSTS) must be set to enable background job queues",
    );
  }

  return redisUrl;
}

// REDIS_SENTINEL_HOSTS is a comma-separated list of host[:port] entries for
// the Sentinel processes (port defaults to 26379). When set it wins over
// REDIS_URL: ioredis then asks Sentinel for the current master and follows
// failovers, which a fixed redis:// address cannot do.
function parseSentinelHosts(raw: string): SentinelAddress[] {
  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    throw new Error("REDIS_SENTINEL_HOSTS is set but contains no hosts");
  }

  return entries.map((entry) => {
    const separator = entry.lastIndexOf(":");
    if (separator === -1) {
      return { host: entry, port: DEFAULT_SENTINEL_PORT };
    }
    const host = entry.slice(0, separator);
    const port = Number(entry.slice(separator + 1));
    if (!host || !Number.isInteger(port) || port <= 0 || port > 65_535) {
      throw new Error(
        `REDIS_SENTINEL_HOSTS entry ${JSON.stringify(entry)} is not host[:port]`,
      );
    }
    return { host, port };
  });
}

function getSentinelOptions(): RedisOptions | undefined {
  const raw = process.env.REDIS_SENTINEL_HOSTS;
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }

  return {
    sentinels: parseSentinelHosts(raw),
    name: process.env.REDIS_SENTINEL_MASTER || DEFAULT_SENTINEL_MASTER,
  };
}

function connect(options: RedisOptions): IORedis {
  const sentinel = getSentinelOptions();
  if (sentinel) {
    return new IORedis({ ...options, ...sentinel });
  }

  return new IORedis(getRedisUrl(), options);
}

// BullMQ requires maxRetriesPerRequest: null — its blocking connections queue
// commands until Redis returns. Only queue producers/workers may use this;
// request-path code must use createCacheRedisConnection, or a Redis outage
// stalls every HTTP request on the offline queue instead of failing over.
export function createRedisConnection(): IORedis {
  return connect({
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

// Request-path connection: commands reject immediately while disconnected
// (no offline queue) and are latency-bounded while connected, so callers hit
// their PostgreSQL fallbacks in milliseconds instead of hanging until the
// upstream 30s proxy timeout.
export function createCacheRedisConnection(): IORedis {
  return connect({
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2000,
    commandTimeout: 500,
  });
}

export function isRedisReady(client: IORedis | undefined): client is IORedis {
  return client?.status === "ready";
}
