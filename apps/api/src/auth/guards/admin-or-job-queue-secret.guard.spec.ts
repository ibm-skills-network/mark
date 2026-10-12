import "reflect-metadata";
import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { LtiSyncAdminController } from "src/api/attempt/controllers/lti-sync-admin.controller";
import { UserSessionRequest } from "../interfaces/user.session.interface";
import { AdminGuard } from "./admin.guard";
import { AdminOrJobQueueSecretGuard } from "./admin-or-job-queue-secret.guard";

const SECRET = "test-job-queue-secret"; // pragma: allowlist secret

describe("AdminOrJobQueueSecretGuard", () => {
  const originalSecret = process.env.JOB_QUEUE_SECRET; // pragma: allowlist secret
  let adminCanActivate: jest.Mock<Promise<boolean>, [ExecutionContext]>;
  let guard: AdminOrJobQueueSecretGuard;

  const buildContext = (headers: Record<string, string>): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () =>
          ({
            headers,
            method: "POST",
            originalUrl: "/api/admin/lti-sync/retry/1",
            get: () => undefined,
          }) as unknown as UserSessionRequest,
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    process.env.JOB_QUEUE_SECRET = SECRET; // pragma: allowlist secret
    adminCanActivate = jest.fn();
    const adminGuard = {
      canActivate: adminCanActivate,
    } as unknown as AdminGuard;
    const logger = {
      child: () => ({ info: jest.fn(), warn: jest.fn() }),
    };
    guard = new AdminOrJobQueueSecretGuard(adminGuard, logger as never);
  });

  afterAll(() => {
    process.env.JOB_QUEUE_SECRET = originalSecret; // pragma: allowlist secret
  });

  it("admits the correct job-queue secret without an admin session", async () => {
    await expect(
      guard.canActivate(buildContext({ "x-job-queue-secret": SECRET })),
    ).resolves.toBe(true);
    expect(adminCanActivate).not.toHaveBeenCalled();
  });

  it("rejects a wrong secret without falling through to the admin check", async () => {
    await expect(
      guard.canActivate(buildContext({ "x-job-queue-secret": "nope" })), // pragma: allowlist secret
    ).resolves.toBe(false);
    await expect(
      guard.canActivate(buildContext({ "x-job-queue-secret": "" })),
    ).resolves.toBe(false);
    expect(adminCanActivate).not.toHaveBeenCalled();
  });

  it("delegates to AdminGuard when no secret header is sent", async () => {
    adminCanActivate.mockRejectedValue(new UnauthorizedException());
    await expect(guard.canActivate(buildContext({}))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    adminCanActivate.mockResolvedValue(true);
    await expect(
      guard.canActivate(buildContext({ "x-admin-token": "tok" })),
    ).resolves.toBe(true);
  });

  it("gates the whole LTI sync admin controller", () => {
    const guards = (Reflect.getMetadata("__guards__", LtiSyncAdminController) ??
      []) as unknown[];
    expect(guards).toContain(AdminOrJobQueueSecretGuard);
  });
});
