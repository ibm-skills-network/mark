import { EventEmitter } from "node:events";
import http from "node:http";
import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runWorker } from "../../src/worker/main.js";
import { captureLogger, testConfig } from "../http/helpers.js";

const TIMER_FAKES: (
  | "setTimeout"
  | "clearTimeout"
  | "setInterval"
  | "clearInterval"
)[] = ["setTimeout", "clearTimeout", "setInterval", "clearInterval"];

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function get(port: number, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: "127.0.0.1", port, path, agent: false },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", reject);
  });
}

function fakeWorkerPrisma(impl: () => Promise<unknown>) {
  const $queryRaw = vi.fn();
  $queryRaw.mockImplementation(impl);
  const $disconnect = vi.fn(() => Promise.resolve());
  return { $queryRaw, $disconnect };
}

function deferred(): { promise: Promise<unknown>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<unknown>((r) => {
    resolve = () => r([{ "?column?": 1 }]);
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("runWorker", () => {
  it("claims nothing and logs worker.idle once a minute when consumeWork is false", async () => {
    vi.useFakeTimers({ toFake: TIMER_FAKES });
    const { logger, lines } = captureLogger();
    const claimOnce = vi.fn(() => Promise.resolve(0));
    const prisma = fakeWorkerPrisma(() => Promise.resolve([]));
    const worker = await runWorker({
      config: testConfig({
        consumeWork: false,
        workerHealthPort: await freePort(),
      }),
      logger,
      prisma,
      signals: new EventEmitter(),
      claimOnce,
    });

    await vi.advanceTimersByTimeAsync(3 * 60_000);

    expect(claimOnce).not.toHaveBeenCalled();
    expect(lines.filter((l) => l.msg === "worker.idle")).toHaveLength(3);
    expect(lines.find((l) => l.msg === "worker.started")).toMatchObject({
      consumeWork: false,
      dispatchExternalEffects: false,
    });
    vi.useRealTimers();
    await worker.stop();
    expect(prisma.$disconnect).toHaveBeenCalledTimes(1);
  });

  it("runs the claim loop when consumeWork is true", async () => {
    vi.useFakeTimers({ toFake: TIMER_FAKES });
    const { logger, lines } = captureLogger();
    const claimOnce = vi.fn(() => Promise.resolve(0));
    const worker = await runWorker({
      config: testConfig({
        consumeWork: true,
        workerHealthPort: await freePort(),
      }),
      logger,
      prisma: fakeWorkerPrisma(() => Promise.resolve([])),
      signals: new EventEmitter(),
      claimOnce,
    });

    await vi.advanceTimersByTimeAsync(3000);

    expect(claimOnce.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(lines.filter((l) => l.msg === "worker.idle")).toHaveLength(0);
    vi.useRealTimers();
    await worker.stop();
    const callsAtStop = claimOnce.mock.calls.length;
    await new Promise((r) => setTimeout(r, 1100));
    expect(claimOnce.mock.calls.length).toBe(callsAtStop);
  });

  it("serves liveness and flips readiness 503 -> 200 once the database answers", async () => {
    const port = await freePort();
    const db = deferred();
    const prisma = fakeWorkerPrisma(() => db.promise);
    const worker = await runWorker({
      config: testConfig({ workerHealthPort: port }),
      logger: captureLogger().logger,
      prisma,
      signals: new EventEmitter(),
    });

    expect(await get(port, "/health/liveness")).toBe(200);
    expect(await get(port, "/health/readiness")).toBe(503);

    db.resolve();
    await vi.waitFor(async () => {
      expect(await get(port, "/health/readiness")).toBe(200);
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);

    await worker.stop();
  });

  it("SIGTERM on the injected emitter stops the worker and closes the port", async () => {
    const port = await freePort();
    const signals = new EventEmitter();
    const { logger, lines } = captureLogger();
    const prisma = fakeWorkerPrisma(() => Promise.resolve([]));
    const worker = await runWorker({
      config: testConfig({ workerHealthPort: port }),
      logger,
      prisma,
      signals,
    });
    expect(await get(port, "/health/liveness")).toBe(200);

    const started = Date.now();
    signals.emit("SIGTERM", "SIGTERM");
    signals.emit("SIGTERM", "SIGTERM");
    await worker.stop();
    expect(Date.now() - started).toBeLessThan(1000);

    await expect(get(port, "/health/liveness")).rejects.toMatchObject({
      code: "ECONNREFUSED",
    });
    expect(prisma.$disconnect).toHaveBeenCalledTimes(1);
    expect(lines.filter((l) => l.msg === "worker.stopping")).toHaveLength(1);
    expect(lines.filter((l) => l.msg === "worker.stopped")).toHaveLength(1);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
  });
});
