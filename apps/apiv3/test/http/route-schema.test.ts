import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildApp } from "../../src/http/app.js";
import { captureLogger, fakePrisma, testConfig } from "./helpers.js";

async function app() {
  const { logger } = captureLogger();
  return buildApp({
    config: testConfig(),
    logger,
    prisma: fakePrisma(() => Promise.resolve([])),
  });
}

describe("response schema requirement", () => {
  it("rejects a root route without a response schema", async () => {
    const a = await app();
    expect(() => a.get("/no-schema", () => ({ ok: true }))).toThrow(
      "route GET /no-schema has no response schema",
    );
    await a.close();
  });

  it("rejects a route without a response schema inside a plugin", async () => {
    const a = await app();
    await expect(
      // avvio does not catch a synchronous throw from a plugin; a promise
      // executor turns the onRoute error into a rejection.
      a.register(
        (scope) =>
          new Promise<void>((resolve) => {
            scope.post("/nested", () => ({ ok: true }));
            resolve();
          }),
      ),
    ).rejects.toThrow("route POST /nested has no response schema");
    await a.close();
  });

  it("accepts a route with a response schema", async () => {
    const a = await app();
    a.get(
      "/with-schema",
      { schema: { response: { 200: z.object({ ok: z.boolean() }) } } },
      () => ({ ok: true }),
    );
    const res = await a.inject({ method: "GET", url: "/with-schema" });
    expect(res.statusCode).toBe(200);
    await a.close();
  });
});
