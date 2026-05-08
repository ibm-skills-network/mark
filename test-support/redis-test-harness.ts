import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import IORedis from "ioredis";

const REDIS_IMAGE = "redis:7-alpine";
const DEFAULT_WAIT_TIMEOUT_MS = 10_000;
const WAIT_INTERVAL_MS = 100;

export interface RedisTestHarness {
  redisUrl: string;
  createClient: () => IORedis;
  flush: () => Promise<void>;
  stop: () => Promise<void>;
}

export interface RedisTestEnvironmentAvailability {
  available: boolean;
  reason?: string;
}

function runCommand(command: string, arguments_: string[]): string {
  const result = spawnSync(command, arguments_, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    throw new Error(
      stderr.length > 0
        ? `${command} ${arguments_.join(" ")} failed: ${stderr}`
        : `${command} ${arguments_.join(" ")} failed with exit code ${result.status ?? "unknown"}`,
    );
  }

  return result.stdout.trim();
}

export function getRedisTestEnvironmentAvailability(): RedisTestEnvironmentAvailability {
  if (process.env.JOB_QUEUE_TEST_REDIS_URL) {
    return { available: true };
  }

  const result = spawnSync("docker", ["info"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    return {
      available: false,
      reason: result.error.message,
    };
  }

  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    return {
      available: false,
      reason:
        stderr.length > 0
          ? stderr
          : `docker info failed with exit code ${result.status ?? "unknown"}`,
    };
  }

  return { available: true };
}

export function isRedisTestEnvironmentAvailable(): boolean {
  return getRedisTestEnvironmentAvailability().available;
}

async function findFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() =>
          reject(new Error("Unable to allocate a Redis test port")),
        );
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

async function waitForRedis(
  redisUrl: string,
  timeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeoutMs;
  let lastError: Error | undefined;

  while (Date.now() < deadline) {
    const client = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });

    try {
      await client.connect();
      await client.ping();
      await client.quit();
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      await client.quit().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, WAIT_INTERVAL_MS));
    }
  }

  throw new Error(
    `Timed out waiting for Redis at ${redisUrl}: ${lastError?.message ?? "unknown error"}`,
  );
}

export async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
  intervalMs = WAIT_INTERVAL_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

export async function createRedisTestHarness(): Promise<RedisTestHarness> {
  const sharedRedisUrl = process.env.JOB_QUEUE_TEST_REDIS_URL;
  if (sharedRedisUrl) {
    await waitForRedis(sharedRedisUrl);
    const createClient = () =>
      new IORedis(sharedRedisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      });

    return {
      redisUrl: sharedRedisUrl,
      createClient,
      async flush() {
        const client = createClient();
        await client.flushdb();
        await client.quit();
      },
      async stop() {
        await Promise.resolve();
      },
    };
  }

  const port = await findFreePort();
  const containerName = `mark-job-queue-test-${randomUUID()}`;
  runCommand("docker", [
    "run",
    "-d",
    "--rm",
    "--name",
    containerName,
    "-p",
    `${port}:6379`,
    REDIS_IMAGE,
  ]);

  const redisUrl = `redis://127.0.0.1:${port}`;

  try {
    await waitForRedis(redisUrl);
  } catch (error) {
    runCommand("docker", ["rm", "-f", containerName]);
    throw error;
  }

  const createClient = () =>
    new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

  return {
    redisUrl,
    createClient,
    async flush() {
      const client = createClient();
      await client.flushdb();
      await client.quit();
    },
    async stop() {
      runCommand("docker", ["rm", "-f", containerName]);
    },
  };
}
