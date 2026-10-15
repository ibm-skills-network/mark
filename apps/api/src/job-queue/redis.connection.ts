import { Logger } from "@nestjs/common";
import IORedis, { RedisOptions } from "ioredis";

const DEFAULT_SENTINEL_PORT = 26_379;
const DEFAULT_SENTINEL_MASTER = "mymaster";
const MAX_PORT = 65_535;
const HOSTNAME_PATTERN = /^[\dA-Za-z](?:[\d.A-Za-z-]*[\dA-Za-z])?$/;
const PORT_PATTERN = /^\d{1,5}$/;
const MASTER_NAME_PATTERN = /^[\w.-]+$/;

const logger = new Logger("RedisConnection");
let loggedMode: "sentinel" | "url" | undefined;

export interface SentinelAddress {
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
// REDIS_URL's address: ioredis asks Sentinel for the current master and
// follows failovers, which a fixed redis:// address cannot do.
export function parseSentinelHosts(raw: string): SentinelAddress[] {
  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    throw new Error("REDIS_SENTINEL_HOSTS is set but contains no hosts");
  }

  return entries.map((entry) => {
    const separator = entry.lastIndexOf(":");
    const host = separator === -1 ? entry : entry.slice(0, separator);
    const portText = separator === -1 ? undefined : entry.slice(separator + 1);
    const port =
      portText === undefined ? DEFAULT_SENTINEL_PORT : Number(portText);
    const validPort =
      portText === undefined ||
      (PORT_PATTERN.test(portText) && port > 0 && port <= MAX_PORT);
    if (!HOSTNAME_PATTERN.test(host) || !validPort) {
      throw new Error(
        `REDIS_SENTINEL_HOSTS entry ${JSON.stringify(
          entry,
        )} is not a valid host[:port]`,
      );
    }
    return { host, port };
  });
}

function getSentinelMasterName(): string {
  const raw = process.env.REDIS_SENTINEL_MASTER?.trim();
  if (!raw) {
    return DEFAULT_SENTINEL_MASTER;
  }
  if (!MASTER_NAME_PATTERN.test(raw)) {
    throw new Error(
      "REDIS_SENTINEL_MASTER must contain only letters, digits, '.', '_' or '-'",
    );
  }
  return raw;
}

// In Sentinel mode REDIS_URL's host/port are ignored, but its credentials,
// database index and TLS scheme still apply to the master/replica connection.
// The URL is never echoed in errors because it carries the password.
export function getRedisUrlAuthOptions(
  redisUrl: string | undefined,
): RedisOptions {
  if (!redisUrl) {
    return {};
  }

  let parsed: URL;
  try {
    parsed = new URL(redisUrl);
  } catch {
    // Rethrown without the parser message: it would echo the URL's password.
    throw new Error("REDIS_URL is not a valid URL");
  }
  if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use the redis:// or rediss:// scheme");
  }

  const options: RedisOptions = {};
  if (parsed.username) {
    options.username = decodeURIComponent(parsed.username);
  }
  if (parsed.password) {
    options.password = decodeURIComponent(parsed.password);
  }
  const databaseText = parsed.pathname.replace(/^\//, "");
  if (databaseText) {
    if (!/^\d+$/.test(databaseText)) {
      throw new Error(
        "REDIS_URL database index must be a non-negative integer",
      );
    }
    options.db = Number(databaseText);
  }
  if (parsed.protocol === "rediss:") {
    options.tls = {};
    options.enableTLSForSentinelMode = true;
  }
  return options;
}

// Sentinel processes authenticate with REDIS_SENTINEL_PASSWORD when set;
// otherwise with REDIS_URL's password, which matches charts that share one
// password between redis and sentinel.
export function getSentinelOptions(): RedisOptions | undefined {
  const raw = process.env.REDIS_SENTINEL_HOSTS;
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }

  const urlOptions = getRedisUrlAuthOptions(process.env.REDIS_URL);
  const sentinelPassword =
    process.env.REDIS_SENTINEL_PASSWORD || urlOptions.password;

  return {
    ...urlOptions,
    sentinels: parseSentinelHosts(raw),
    name: getSentinelMasterName(),
    ...(sentinelPassword ? { sentinelPassword } : {}),
  };
}

function logModeOnce(mode: "sentinel" | "url", sentinel?: RedisOptions): void {
  if (loggedMode === mode) {
    return;
  }
  loggedMode = mode;
  if (mode === "sentinel" && sentinel) {
    logger.log(
      `Redis connection mode: sentinel (master=${String(
        sentinel.name,
      )}, sentinels=${(sentinel.sentinels ?? [])
        .map((s) => `${String(s.host)}:${String(s.port)}`)
        .join(",")}, tls=${sentinel.tls ? "on" : "off"}, auth=${
        sentinel.password ? "on" : "off"
      }, sentinelAuth=${sentinel.sentinelPassword ? "on" : "off"})`,
    );
  } else {
    logger.log("Redis connection mode: url (REDIS_URL)");
  }
}

// Called once at process start so a malformed REDIS_SENTINEL_HOSTS /
// REDIS_SENTINEL_MASTER / REDIS_URL stops the boot with a clear error instead
// of surfacing later inside a lazily created (and sometimes try/caught)
// connection. A missing REDIS_URL is still tolerated here, as before.
export function validateRedisConnectionConfig(): void {
  const sentinel = getSentinelOptions();
  if (sentinel) {
    logModeOnce("sentinel", sentinel);
  } else if (process.env.REDIS_URL) {
    logModeOnce("url");
  }
}

function connect(options: RedisOptions): IORedis {
  const sentinel = getSentinelOptions();
  if (sentinel) {
    logModeOnce("sentinel", sentinel);
    return new IORedis({ ...options, ...sentinel });
  }

  const redisUrl = getRedisUrl();
  logModeOnce("url");
  return new IORedis(redisUrl, options);
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
