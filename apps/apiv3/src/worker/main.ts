import type { EventEmitter } from "node:events";
import type { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";
import type { Config } from "../shared/config.js";
import { pingDatabase } from "../shared/db-ping.js";
import { buildHealthServer } from "./health.js";

export const IDLE_LOG_INTERVAL_MS = 60000;
export const READINESS_REFRESH_MS = 30000;
export const EMPTY_CLAIM_BACKOFF_MS = 1000;

export type WorkerDeps = {
  config: Config;
  logger: Logger;
  prisma: Pick<PrismaClient, "$queryRaw" | "$disconnect">;
  signals?: EventEmitter;
  // Injectable so tests can observe the loop; defaults to the module's claimOnce.
  claimOnce?: () => Promise<number>;
};

export type Worker = { stop(): Promise<void> };

// Claims and runs one batch of work; returns how many items it handled.
// Nothing is claimable until the work store lands.
export function claimOnce(): Promise<number> {
  return Promise.resolve(0);
}

export async function runWorker(deps: WorkerDeps): Promise<Worker> {
  const { config, logger, prisma } = deps;
  const signals = deps.signals ?? process;
  const claim = deps.claimOnce ?? claimOnce;

  let ready = false;
  let stopping = false;
  let stopPromise: Promise<void> | undefined;
  let readinessCheck: Promise<void> | undefined;
  let idleTimer: NodeJS.Timeout | undefined;
  let claimLoop: Promise<void> | undefined;
  let wakeSleep: (() => void) | undefined;

  const server = buildHealthServer({ logger, isReady: () => ready });

  async function checkReadiness(): Promise<void> {
    const was = ready;
    try {
      await pingDatabase(prisma);
      ready = true;
      if (!was) logger.info({ database: "ok" }, "worker.readiness");
    } catch (err) {
      ready = false;
      logger.warn(
        {
          database: "fail",
          reason: err instanceof Error ? err.name : "unknown",
          detail: err instanceof Error ? err.message : String(err),
        },
        "worker.readiness",
      );
    }
  }

  function refreshReadiness(): void {
    // Skip if the previous check is still pending; it bounds itself by timeout.
    if (readinessCheck || stopping) return;
    readinessCheck = checkReadiness().finally(() => {
      readinessCheck = undefined;
    });
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done(): void {
        clearTimeout(timer);
        wakeSleep = undefined;
        resolve();
      }
      wakeSleep = done;
    });
  }

  // A failed claim is logged and counted as an empty batch so the loop backs off.
  async function claimOrZero(): Promise<number> {
    try {
      return await claim();
    } catch (err) {
      logger.error({ err }, "worker.claim_failed");
      return 0;
    }
  }

  async function runClaimLoop(): Promise<void> {
    while (!stopping) {
      const n = await claimOrZero();
      if (stopping) break;
      await sleep(n > 0 ? 0 : EMPTY_CLAIM_BACKOFF_MS);
    }
  }

  function onSignal(signal: NodeJS.Signals): void {
    logger.info({ signal }, "worker.signal");
    void stop();
  }

  async function shutdown(): Promise<void> {
    stopping = true;
    logger.info({}, "worker.stopping");
    clearInterval(idleTimer);
    clearInterval(readinessTimer);
    wakeSleep?.();
    await server.close();
    await claimLoop;
    await readinessCheck;
    await prisma.$disconnect();
    // Detach only once drained so a repeated signal mid-drain is absorbed.
    for (const s of ["SIGTERM", "SIGINT"] as const) {
      signals.off(s, onSignal);
    }
    logger.info({}, "worker.stopped");
  }

  function stop(): Promise<void> {
    stopPromise ??= shutdown();
    return stopPromise;
  }

  try {
    await server.listen({ port: config.workerHealthPort, host: "0.0.0.0" });
  } catch (err) {
    logger.error(
      { err, port: config.workerHealthPort },
      "worker.health_listen_failed",
    );
    await server.close();
    throw err;
  }

  // .on, not .once: a repeated signal must not fall through to the default
  // handler and kill the process mid-drain.
  for (const s of ["SIGTERM", "SIGINT"] as const) {
    signals.on(s, onSignal);
  }

  refreshReadiness();
  // Declared after listen; shutdown() can only run once start has finished.
  const readinessTimer = setInterval(refreshReadiness, READINESS_REFRESH_MS);

  logger.info(
    {
      consumeWork: config.consumeWork,
      dispatchExternalEffects: config.dispatchExternalEffects,
      healthPort: config.workerHealthPort,
    },
    "worker.started",
  );

  if (config.consumeWork) {
    claimLoop = runClaimLoop();
  } else {
    idleTimer = setInterval(() => {
      logger.info({ consumeWork: false }, "worker.idle");
    }, IDLE_LOG_INTERVAL_MS);
  }

  return { stop };
}
