import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { AdminVerificationService } from "../services/admin-verification.service";
import {
  UserRole,
  UserSessionRequest,
} from "../interfaces/user.session.interface";
import { AdminGuard } from "./admin.guard";

type VerifyResult = Awaited<
  ReturnType<AdminVerificationService["verifyAdminSession"]>
>;

describe("AdminGuard", () => {
  let guard: AdminGuard;
  let verifyAdminSession: jest.Mock<Promise<VerifyResult>, [string]>;

  const buildContext = (
    request: Partial<UserSessionRequest>,
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  const buildRequest = (
    token: string | undefined,
  ): Partial<UserSessionRequest> =>
    ({
      headers: token ? { "x-admin-token": token } : {},
      method: "GET",
      originalUrl: "/api/v1/admin-dashboard/queue-status",
      get: () => undefined,
    }) as unknown as Partial<UserSessionRequest>;

  beforeEach(() => {
    verifyAdminSession = jest.fn();
    const adminVerificationService = {
      verifyAdminSession,
    } as unknown as AdminVerificationService;
    const logger = {
      child: () => ({ warn: jest.fn(), debug: jest.fn() }),
    };
    guard = new AdminGuard(adminVerificationService, logger as never);
  });

  it("rejects a request with no admin token", async () => {
    await expect(
      guard.canActivate(buildContext(buildRequest(undefined))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(verifyAdminSession).not.toHaveBeenCalled();
  });

  it("rejects an invalid or expired session", async () => {
    verifyAdminSession.mockResolvedValue(null);
    await expect(
      guard.canActivate(buildContext(buildRequest("tok"))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects a valid session whose email is not an admin (author role)", async () => {
    // The dashboard surface is admin-only: an authenticated non-admin session
    // must not pass, even though its session is otherwise valid.
    verifyAdminSession.mockResolvedValue({
      email: "author@example.com",
      role: "author",
    });
    await expect(
      guard.canActivate(buildContext(buildRequest("tok"))),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("grants an admin-role session and stamps the ADMIN role", async () => {
    verifyAdminSession.mockResolvedValue({
      email: "Admin@Example.com",
      role: "admin",
    });
    const request = buildRequest("tok");
    await expect(guard.canActivate(buildContext(request))).resolves.toBe(true);
    expect(request.userSession?.role).toBe(UserRole.ADMIN);
    expect(request.userSession?.userId).toBe("admin@example.com");
  });
});
