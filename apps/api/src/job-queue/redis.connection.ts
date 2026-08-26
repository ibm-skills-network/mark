import IORedis from "ioredis";

export function getRedisUrl(): string {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL must be set to enable background job queues");
  }

  return redisUrl;
}

// BullMQ requires maxRetriesPerRequest: null — its blocking connections queue
// commands until Redis returns. Only queue producers/workers may use this;
// request-path code must use createCacheRedisConnection, or a Redis outage
// stalls every HTTP request on the offline queue instead of failing over.
export function createRedisConnection(): IORedis {
  return new IORedis(getRedisUrl(), {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

// Request-path connection: commands reject immediately while disconnected
// (no offline queue) and are latency-bounded while connected, so callers hit
// their PostgreSQL fallbacks in milliseconds instead of hanging until the
// upstream 30s proxy timeout.
export function createCacheRedisConnection(): IORedis {
  return new IORedis(getRedisUrl(), {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2000,
    commandTimeout: 500,
  });
}

export function isRedisReady(client: IORedis | undefined): client is IORedis {
  return client?.status === "ready";
}
