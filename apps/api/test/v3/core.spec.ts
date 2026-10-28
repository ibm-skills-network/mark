import { Controller, Get, Module } from "@nestjs/common";
import request from "supertest";
import { z } from "zod";
import { V3Controller } from "../../src/v3/core/v3-controller.decorator";
import {
  createV3TestApp,
  learner,
  type V3TestApp,
} from "./helpers/v3-test-app";

// Contract: v3 routes live at /api/v3 + public path, carry their own error
// envelope and response contract, and no legacy global touches them.
describe("v3 core", () => {
  let t: V3TestApp;
  beforeAll(async () => {
    t = await createV3TestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(() => {
    t.logs.length = 0;
  });

  const http = () => request(t.app.getHttpServer());

  describe("routing", () => {
    it("serves v3 routes at /api/v3 + the public path", async () => {
      const res = await http()
        .post("/api/v3/probe/echo")
        .set("x-request-id", "rid-1")
        .send({ n: 3 });
      expect(res.status).toBe(201);
    });

    it.each([
      "/api/v1/probe/echo",
      "/api/v2/probe/echo",
      "/api/probe/echo",
      "/v3/probe/echo",
      "/_next/probe/echo",
    ])("does not serve v3 routes at %s", async (path) => {
      const res = await http().post(path).send({ n: 3 });
      expect(res.status).toBe(404);
    });

    it("does not serve legacy routes under /api/v3", async () => {
      expect((await http().post("/api/v1/legacy-probe").send({})).status).toBe(
        201,
      );
      expect((await http().post("/api/v3/legacy-probe").send({})).status).toBe(
        404,
      );
    });
  });

  describe("legacy globals do not touch v3 responses", () => {
    it("keeps schema key order, strips unknown keys, skips base64 field encoding", async () => {
      const res = await http()
        .post("/api/v3/probe/echo")
        .set("x-request-id", "rid-2")
        .send({ n: 3 });
      expect(res.text).toBe(
        '{"n":3,"content":"hello","at":"2026-01-01T00:00:00.000Z"}',
      );
    });

    it("still applies them to legacy routes", async () => {
      const res = await http().post("/api/v1/legacy-probe").send({ a: 1 });
      expect(res.status).toBe(201);
      // DataTransformInterceptor base64-encodes `content` outside v3.
      expect(res.body.content).not.toBe("hello");
      expect(res.body.at).toBe("2026-01-01T00:00:00.000Z");
    });
  });

  describe("request validation", () => {
    it("rejects an invalid body with the v3 envelope", async () => {
      const res = await http()
        .post("/api/v3/probe/echo")
        .set("x-request-id", "rid-3")
        .send({ n: "three" });
      expect(res.status).toBe(400);
      expect(res.text).toBe(
        '{"code":"BAD_REQUEST","message":"Invalid request","requestId":"rid-3"}',
      );
    });
  });

  describe("errors", () => {
    it("turns an unexpected error into INTERNAL without leaking its message", async () => {
      const res = await http()
        .get("/api/v3/probe/boom")
        .set("x-request-id", "rid-4");
      expect(res.status).toBe(500);
      expect(res.text).toBe(
        '{"code":"INTERNAL","message":"Internal error","requestId":"rid-4"}',
      );
      const failure = t.logs.find((l) => l.event === "v3.request.failed");
      expect(failure).toMatchObject({
        level: "error",
        request_id: "rid-4",
        outcome: "failed",
        error: { name: "Error" },
      });
      expect(JSON.stringify(failure)).toContain("connect failed");
    });

    it("maps a V3Error to its status, code and generic message", async () => {
      const res = await http()
        .get("/api/v3/probe/forbidden")
        .set("x-request-id", "rid-5");
      expect(res.status).toBe(403);
      expect(res.text).toBe(
        '{"code":"FORBIDDEN","message":"Forbidden","requestId":"rid-5"}',
      );
      expect(t.logs).toContainEqual(
        expect.objectContaining({
          event: "v3.request.rejected",
          reason: "not_owner",
          request_id: "rid-5",
        }),
      );
    });

    it("rejects a response that breaks its contract", async () => {
      const res = await http()
        .get("/api/v3/probe/contract")
        .set("x-request-id", "rid-6");
      expect(res.status).toBe(500);
      expect(res.text).toBe(
        '{"code":"INTERNAL","message":"Internal error","requestId":"rid-6"}',
      );
      expect(t.logs).toContainEqual(
        expect.objectContaining({
          event: "v3.response_contract_violation",
          request_id: "rid-6",
        }),
      );
    });
  });

  describe("body limits", () => {
    const mib = 1024 * 1024;

    it.each(["/api/v3/probe/echo", "/API/V3/probe/echo", "/api/V3/probe/echo"])(
      "refuses v3 bodies over 1 MiB with the envelope at %s",
      async (path) => {
        const res = await http()
          .post(path)
          .set("x-request-id", "rid-7")
          .set("content-type", "application/json")
          .send(JSON.stringify({ n: 1, pad: "x".repeat(mib + 10) }));
        expect(res.status).toBe(413);
        expect(res.text).toBe(
          '{"code":"PAYLOAD_TOO_LARGE","message":"Payload too large","requestId":"rid-7"}',
        );
      },
    );

    it("keeps the legacy limit for legacy routes", async () => {
      const res = await http()
        .post("/api/v1/legacy-probe")
        .set("content-type", "application/json")
        .send(JSON.stringify({ pad: "x".repeat(2 * mib) }));
      expect(res.status).toBe(201);
    });
  });

  describe("request ids", () => {
    it("prefers akamai-grn and echoes it", async () => {
      const res = await http()
        .post("/api/v3/probe/echo")
        .set("akamai-grn", "0.abc.123")
        .set("x-request-id", "other")
        .send({ n: 1 });
      expect(res.headers["x-request-id"]).toBe("0.abc.123");
    });

    it.each([
      ["missing", undefined],
      ["unsafe", "bad id with spaces"],
    ])("generates a UUID when the id is %s", async (_why, id) => {
      const req = http().get("/api/v3/probe/boom");
      if (id) req.set("x-request-id", id);
      const res = await req;
      expect(res.headers["x-request-id"]).toMatch(
        /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/,
      );
      expect(JSON.parse(res.text).requestId).toBe(res.headers["x-request-id"]);
    });
  });

  describe("principal", () => {
    it("401s without a session", async () => {
      const res = await http()
        .get("/api/v3/probe/whoami")
        .set("x-request-id", "rid-8");
      expect(res.status).toBe(401);
      expect(res.text).toBe(
        '{"code":"UNAUTHORIZED","message":"Unauthorized","requestId":"rid-8"}',
      );
    });

    it("400s a malformed session and logs only the reason", async () => {
      const res = await http()
        .get("/api/v3/probe/whoami")
        .set("x-request-id", "rid-9")
        .set("user-session", '{"userId":5,"role":"learner"}');
      expect(res.status).toBe(400);
      expect(res.text).toBe(
        '{"code":"BAD_REQUEST","message":"Invalid user session","requestId":"rid-9"}',
      );
      const line = t.logs.find((l) => l.event === "v3.request.rejected");
      expect(line).toMatchObject({ reason: "userId_not_string" });
      expect(JSON.stringify(t.logs)).not.toContain('"userId":5');
    });

    it("passes a valid session to the handler", async () => {
      const res = await http()
        .get("/api/v3/probe/whoami")
        .set("user-session", JSON.stringify(learner));
      expect(res.status).toBe(200);
      expect(res.text).toBe('{"userId":"a@b.co","role":"learner"}');
    });
  });
});

describe("v3 route registration", () => {
  it("refuses to start when a v3 route has no response contract", async () => {
    @V3Controller("api/v1/unsafe")
    class UnsafeController {
      @Get()
      get() {
        return { ok: true };
      }
    }
    @Module({ controllers: [UnsafeController] })
    class UnsafeModule {}

    await expect(
      createV3TestApp({ extraV3Modules: [UnsafeModule] }),
    ).rejects.toThrow(/UnsafeController.*response contract/);
  });

  it("does not police plain legacy controllers", async () => {
    @Controller({ path: "legacy-free", version: "1" })
    class FreeController {
      @Get()
      get() {
        return { ok: z.literal(true).parse(true) };
      }
    }
    @Module({ controllers: [FreeController] })
    class FreeModule {}
    await expect(
      createV3TestApp({ extraV3Modules: [FreeModule] }).then((app) =>
        app.close(),
      ),
    ).resolves.toBeUndefined();
  });
});
