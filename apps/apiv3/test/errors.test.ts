import { describe, expect, it } from "vitest";
import { z } from "zod";
import { NotFoundError, errorEnvelope } from "../src/shared/errors.js";
import { newRequestId, requestIdFrom } from "../src/shared/ids.js";

describe("errorEnvelope", () => {
  it("maps AppError to its code/status/message", () => {
    expect(errorEnvelope(new NotFoundError("x"), "r1")).toEqual({
      status: 404,
      body: { code: "NOT_FOUND", message: "x", requestId: "r1" },
    });
  });

  it("maps zod errors to 400 without field names", () => {
    const result = z.object({ secretField: z.string() }).safeParse({});
    if (result.success) throw new Error("expected failure");
    const env = errorEnvelope(result.error, "r2");
    expect(env.status).toBe(400);
    expect(env.body.code).toBe("VALIDATION_FAILED");
    expect(env.body.message).toBe("Invalid request");
    expect(JSON.stringify(env.body)).not.toContain("secretField");
  });

  it("hides unknown error messages", () => {
    const env = errorEnvelope(
      new Error("connection refused to internal-db-host"),
      "r3",
    );
    expect(env).toEqual({
      status: 500,
      body: {
        code: "INTERNAL_ERROR",
        message: "Internal error",
        requestId: "r3",
      },
    });
  });
});

describe("request ids", () => {
  it("generates uuids", () => {
    expect(newRequestId()).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("prefers akamai-grn then x-request-id", () => {
    expect(requestIdFrom({ "akamai-grn": "a", "x-request-id": "b" })).toBe("a");
    expect(requestIdFrom({ "x-request-id": "b" })).toBe("b");
    expect(requestIdFrom({ "x-request-id": ["c", "d"] })).toBe("c");
  });
  it("rejects invalid values", () => {
    expect(requestIdFrom({ "x-request-id": "has space" })).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect(requestIdFrom({ "x-request-id": "x".repeat(129) })).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect(requestIdFrom({})).toMatch(/^[0-9a-f-]{36}$/);
  });
});
