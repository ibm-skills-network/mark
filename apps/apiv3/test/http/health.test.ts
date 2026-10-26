import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/http/app.js";
import { captureLogger, fakePrisma, testConfig } from "./helpers.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("health routes", () => {
  it("liveness returns ok without touching the database", async () => {
    const prisma = fakePrisma(() => Promise.reject(new Error("db down")));
    const app = await buildApp({
      config: testConfig(),
      logger: captureLogger().logger,
      prisma,
    });
    const res = await app.inject({ method: "GET", url: "/health/liveness" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    await app.close();
  });

  it("readiness returns ok when the database answers", async () => {
    const prisma = fakePrisma(() => Promise.resolve([{ "?column?": 1 }]));
    const app = await buildApp({
      config: testConfig(),
      logger: captureLogger().logger,
      prisma,
    });
    const res = await app.inject({ method: "GET", url: "/health/readiness" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", checks: { database: "ok" } });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("readiness degrades when the database query rejects", async () => {
    const { logger, lines } = captureLogger();
    const app = await buildApp({
      config: testConfig(),
      logger,
      prisma: fakePrisma(() => Promise.reject(new Error("refused"))),
    });
    const res = await app.inject({ method: "GET", url: "/health/readiness" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      status: "degraded",
      checks: { database: "fail" },
    });
    expect(lines.some((l) => l.level === 40)).toBe(true);
    await app.close();
  });

  it("readiness degrades after 2000 ms when the database hangs", async () => {
    const { logger, lines } = captureLogger();
    const app = await buildApp({
      config: testConfig(),
      logger,
      prisma: fakePrisma(() => new Promise<never>(() => undefined)),
    });
    await app.ready();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = app.inject({ method: "GET", url: "/health/readiness" });
    await vi.advanceTimersByTimeAsync(1999);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const res = await pending;
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      status: "degraded",
      checks: { database: "fail" },
    });
    expect(lines.some((l) => l.level === 40)).toBe(true);
    await app.close();
  });

  it("echoes the akamai-grn as x-request-id", async () => {
    const app = await buildApp({
      config: testConfig(),
      logger: captureLogger().logger,
      prisma: fakePrisma(() => Promise.resolve([])),
    });
    const res = await app.inject({
      method: "GET",
      url: "/health/liveness",
      headers: { "akamai-grn": "abc" },
    });
    expect(res.headers["x-request-id"]).toBe("abc");
    await app.close();
  });

  it("generates an x-request-id when none is supplied", async () => {
    const app = await buildApp({
      config: testConfig(),
      logger: captureLogger().logger,
      prisma: fakePrisma(() => Promise.resolve([])),
    });
    const res = await app.inject({ method: "GET", url: "/health/liveness" });
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    await app.close();
  });

  it("logs one request.completed line without query string or headers", async () => {
    const { logger, lines } = captureLogger();
    const app = await buildApp({
      config: testConfig(),
      logger,
      prisma: fakePrisma(() => Promise.resolve([])),
    });
    await app.inject({
      method: "GET",
      url: "/health/liveness?token=secret",
      headers: { "akamai-grn": "req-1", authorization: "Bearer secret" },
    });
    const done = lines.filter((l) => l.msg === "request.completed");
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({
      requestId: "req-1",
      method: "GET",
      url: "/health/liveness",
      status: 200,
    });
    expect(typeof done[0]?.durationMs).toBe("number");
    expect(JSON.stringify(lines)).not.toContain("secret");
    await app.close();
  });
});
