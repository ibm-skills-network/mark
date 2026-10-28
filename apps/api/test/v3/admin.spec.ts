import { Get, Module } from "@nestjs/common";
import request from "supertest";
import { z } from "zod";
import { AdminAuthModule } from "../../src/auth/admin-auth.module";
import { AdminVerificationService } from "../../src/auth/services/admin-verification.service";
import { UseAdmin } from "../../src/v3/core/admin.guard";
import { V3Principal } from "../../src/v3/core/principal.guard";
import type { Principal } from "../../src/v3/core/principal";
import {
  V3Controller,
  V3Route,
} from "../../src/v3/core/v3-controller.decorator";
import { createV3TestApp, type V3TestApp } from "./helpers/v3-test-app";

// Contract: an admin route needs a live admin session in x-admin-token. No
// token or an unknown one is 401, an author session is 403, and the token
// itself is never logged.
const sessions: Record<string, { email: string; role: "admin" | "author" }> = {
  "admin-token-0123456789": { email: "admin@example.com", role: "admin" },
  "author-token-0123456789": { email: "author@example.com", role: "author" },
};

@V3Controller("admin/probe")
class AdminProbeController {
  @Get()
  @UseAdmin()
  @V3Route({ response: z.object({ userId: z.string(), role: z.string() }) })
  whoami(@V3Principal() principal: Principal) {
    return { userId: principal.userId, role: principal.role };
  }
}

@Module({ imports: [AdminAuthModule], controllers: [AdminProbeController] })
class AdminProbeModule {}

describe("v3 admin routes", () => {
  let t: V3TestApp;
  beforeAll(async () => {
    t = await createV3TestApp({
      extraV3Modules: [AdminProbeModule],
      overrides: [
        {
          provide: AdminVerificationService,
          useValue: {
            verifyAdminSession: (token: string) =>
              Promise.resolve(sessions[token] ?? null),
          },
        },
      ],
    });
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(() => {
    t.logs.length = 0;
  });

  const get = (token?: string) => {
    const req = request(t.app.getHttpServer())
      .get("/api/v3/admin/probe")
      .set("x-request-id", "rid-admin");
    return token === undefined ? req : req.set("x-admin-token", token);
  };

  it("serves an admin session", async () => {
    const res = await get("admin-token-0123456789");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: "admin@example.com", role: "admin" });
  });

  it.each([
    ["no token", undefined, 401, "admin_token_missing"],
    ["an empty token", "", 401, "admin_token_missing"],
    ["an unknown token", "unknown-token-0123456789", 401, "admin_session_invalid"],
    ["an author session", "author-token-0123456789", 403, "not_admin"],
  ])("refuses %s", async (_name, token, status, reason) => {
    const res = await get(token);
    expect(res.status).toBe(status);
    expect(res.body).toEqual({
      code: status === 401 ? "UNAUTHORIZED" : "FORBIDDEN",
      message: status === 401 ? "Unauthorized" : "Forbidden",
      requestId: "rid-admin",
    });
    expect(t.logs.filter((l) => l.event === "v3.request.rejected")).toEqual([
      expect.objectContaining({ reason, request_id: "rid-admin" }),
    ]);
    if (token) {
      expect(JSON.stringify(t.logs)).not.toContain(token);
    }
  });

  it("logs the admin as the request's user", async () => {
    await get("admin-token-0123456789");
    expect(
      t.logs.filter((l) => l.event === "v3.request.completed"),
    ).toEqual([
      expect.objectContaining({ user_id: "admin@example.com", role: "admin" }),
    ]);
  });
});
