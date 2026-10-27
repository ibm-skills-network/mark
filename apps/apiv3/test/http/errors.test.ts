import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildApp } from "../../src/http/app.js";
import { BadRequestError } from "../../src/shared/errors.js";
import type { Config } from "../../src/shared/config.js";
import { captureLogger, fakePrisma, testConfig } from "./helpers.js";

async function appWith(overrides: Partial<Config> = {}) {
  const { logger, lines } = captureLogger();
  const app = await buildApp({
    config: testConfig(overrides),
    logger,
    prisma: fakePrisma(() => Promise.resolve([])),
  });
  return { app, lines };
}

const okSchema = z.object({ ok: z.boolean() });

describe("error envelope", () => {
  it("returns a 404 envelope for unknown routes", async () => {
    const { app } = await appWith();
    const res = await app.inject({
      method: "GET",
      url: "/nope",
      headers: { "akamai-grn": "rid-404" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      code: "NOT_FOUND",
      message: "Not found",
      requestId: "rid-404",
    });
    expect(res.headers["x-request-id"]).toBe("rid-404");
    await app.close();
  });

  it("hides unexpected errors behind a 500 envelope and logs them", async () => {
    const { app, lines } = await appWith();
    app.get("/boom", { schema: { response: { 200: okSchema } } }, () => {
      throw new Error("boom");
    });
    const res = await app.inject({
      method: "GET",
      url: "/boom",
      headers: { "akamai-grn": "rid-500" },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      code: "INTERNAL_ERROR",
      message: "Internal error",
      requestId: "rid-500",
    });
    const failed = lines.find((l) => l.msg === "request.failed");
    expect(failed?.level).toBe(50);
    expect(failed?.requestId).toBe("rid-500");
    expect(failed?.err?.message).toBe("boom");
    expect(failed?.err?.stack).toContain("boom");
    await app.close();
  });

  it("returns AppError status and logs 4xx at warn without a stack", async () => {
    const { app, lines } = await appWith();
    app.get("/bad-request", { schema: { response: { 200: okSchema } } }, () => {
      throw new BadRequestError();
    });
    const res = await app.inject({ method: "GET", url: "/bad-request" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: "BAD_REQUEST",
      message: "Bad request",
    });
    const failed = lines.find((l) => l.msg === "request.failed");
    expect(failed?.level).toBe(40);
    expect(JSON.stringify(failed)).not.toContain("at ");
    await app.close();
  });

  it("rejects malformed JSON bodies with a generic 400", async () => {
    const { app } = await appWith();
    app.post("/echo", { schema: { response: { 200: okSchema } } }, () => ({
      ok: true,
    }));
    const res = await app.inject({
      method: "POST",
      url: "/echo",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "BAD_REQUEST" });
    await app.close();
  });

  it("rejects bodies over 1 MiB with 413", async () => {
    const { app } = await appWith();
    app.post("/echo", { schema: { response: { 200: okSchema } } }, () => ({
      ok: true,
    }));
    const res = await app.inject({
      method: "POST",
      url: "/echo",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ blob: "x".repeat(1048576) }),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    await app.close();
  });

  it("rejects request bodies that fail the zod schema with a generic 400", async () => {
    const { app } = await appWith();
    app.post(
      "/typed",
      {
        schema: {
          body: z.object({ secretField: z.string() }),
          response: { 200: okSchema },
        },
      },
      () => ({ ok: true }),
    );
    const res = await app.inject({
      method: "POST",
      url: "/typed",
      payload: { secretField: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: "VALIDATION_FAILED",
      message: "Invalid request",
    });
    expect(res.body).not.toContain("secretField");
    await app.close();
  });
});

describe("response validation", () => {
  it("replies 500 RESPONSE_SCHEMA_VIOLATION when the body breaks the schema", async () => {
    const { app } = await appWith({ validateResponses: true });
    app.get(
      "/bad-shape",
      {
        schema: { response: { 200: okSchema } },
        config: { responseSchema: okSchema },
      },
      () => ({ extra: 1 }),
    );
    const res = await app.inject({
      method: "GET",
      url: "/bad-shape",
      headers: { "akamai-grn": "rid-rsv" },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      code: "RESPONSE_SCHEMA_VIOLATION",
      message: "Response failed validation",
      requestId: "rid-rsv",
    });
    await app.close();
  });

  it("checks pre-serialized payloads in onSend when enabled", async () => {
    const { app, lines } = await appWith({ validateResponses: true });
    app.get(
      "/raw",
      {
        schema: { response: { 200: okSchema } },
        config: { responseSchema: okSchema },
      },
      (_req, reply) =>
        reply.type("application/json").send(JSON.stringify({ extra: 1 })),
    );
    const res = await app.inject({ method: "GET", url: "/raw" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ code: "RESPONSE_SCHEMA_VIOLATION" });
    expect(lines.some((l) => l.msg === "response.schema_violation")).toBe(true);
    await app.close();
  });

  it("leaves onSend payloads alone when validation is disabled", async () => {
    const { app } = await appWith({ validateResponses: false });
    app.get(
      "/raw",
      {
        schema: { response: { 200: okSchema } },
        config: { responseSchema: okSchema },
      },
      (_req, reply) =>
        reply.type("application/json").send(JSON.stringify({ extra: 1 })),
    );
    const res = await app.inject({ method: "GET", url: "/raw" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("passes conforming responses", async () => {
    const { app } = await appWith({ validateResponses: true });
    app.get(
      "/good",
      {
        schema: { response: { 200: okSchema } },
        config: { responseSchema: okSchema },
      },
      () => ({ ok: true }),
    );
    const res = await app.inject({ method: "GET", url: "/good" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});
