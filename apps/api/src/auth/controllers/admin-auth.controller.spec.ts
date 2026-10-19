import { BadRequestException } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { ThrottlerModule } from "@nestjs/throttler";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";

import { AdminGuard } from "../guards/admin.guard";
import type { UserSessionRequest } from "../interfaces/user.session.interface";
import { AdminAssumeRoleService } from "../services/admin-assume-role.service";
import { AdminEmailService } from "../services/admin-email.service";
import { AdminVerificationService } from "../services/admin-verification.service";
import { AdminAuthController } from "./admin-auth.controller";

const mockLogger = {
  child: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
};

describe("AdminAuthController — enumeration guards", () => {
  let controller: AdminAuthController;
  let verification: {
    isAuthorizedEmail: jest.Mock;
    generateAndStoreCode: jest.Mock;
    verifyCode: jest.Mock;
    generateAdminSession: jest.Mock;
  };
  let emailService: { sendVerificationCode: jest.Mock };
  let assumeRole: { assumeRole: jest.Mock };

  beforeEach(async () => {
    verification = {
      isAuthorizedEmail: jest.fn(),
      generateAndStoreCode: jest.fn().mockResolvedValue("123456"),
      verifyCode: jest.fn(),
      generateAdminSession: jest
        .fn()
        .mockResolvedValue("session-token-deadbeef"),
    };
    emailService = { sendVerificationCode: jest.fn().mockResolvedValue(true) };
    assumeRole = {
      assumeRole: jest.fn().mockResolvedValue({
        userId: "admin@example.com",
        role: "learner",
        assignmentId: 7,
        groupId: "g1",
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      // ThrottlerModule provides the dependencies ThrottlerGuard needs;
      // the guard itself is inert in unit tests because we invoke handlers
      // directly rather than through the HTTP routing layer.
      imports: [
        ThrottlerModule.forRoot([
          { name: "default", ttl: 60_000, limit: 1000 },
          { name: "strict", ttl: 60_000, limit: 1000 },
        ]),
      ],
      controllers: [AdminAuthController],
      providers: [
        { provide: AdminVerificationService, useValue: verification },
        { provide: AdminEmailService, useValue: emailService },
        { provide: AdminAssumeRoleService, useValue: assumeRole },
        { provide: WINSTON_MODULE_PROVIDER, useValue: mockLogger },
      ],
    }).compile();

    controller = module.get(AdminAuthController);
  });

  describe("send-code", () => {
    it("returns the same generic 200 for authorized and unauthorized emails", async () => {
      verification.isAuthorizedEmail.mockResolvedValueOnce(true);
      const okAuthorized = await controller.sendVerificationCode({
        email: "admin@example.com",
      });

      verification.isAuthorizedEmail.mockResolvedValueOnce(false);
      const okUnauthorized = await controller.sendVerificationCode({
        email: "stranger@example.com",
      });

      expect(okAuthorized).toEqual(okUnauthorized);
      expect(okAuthorized.success).toBe(true);
      // Message must not confirm whether the email is on the allowlist.
      expect(okAuthorized.message).not.toMatch(/not authorized/i);
      expect(okAuthorized.message).toMatch(/if the email is authorized/i);
    });

    it("does not call SMTP for an unauthorized email", async () => {
      verification.isAuthorizedEmail.mockResolvedValue(false);
      await controller.sendVerificationCode({
        email: "stranger@example.com",
      });
      expect(verification.generateAndStoreCode).not.toHaveBeenCalled();
      expect(emailService.sendVerificationCode).not.toHaveBeenCalled();
    });

    it("returns 200 (not 4xx/5xx) when SMTP fails for an authorized email", async () => {
      verification.isAuthorizedEmail.mockResolvedValue(true);
      emailService.sendVerificationCode.mockResolvedValue(false);
      const result = await controller.sendVerificationCode({
        email: "admin@example.com",
      });
      expect(result.success).toBe(true);
    });

    it("rejects malformed email format with BadRequestException", async () => {
      await expect(
        controller.sendVerificationCode({ email: "not-an-email" }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(verification.isAuthorizedEmail).not.toHaveBeenCalled();
    });
  });

  describe("verify-code", () => {
    it("returns the same generic 400 for unauthorized email and for invalid code", async () => {
      verification.isAuthorizedEmail.mockResolvedValueOnce(false);
      verification.verifyCode.mockResolvedValueOnce(true);
      const unauthorizedError = await controller
        .verifyCode({ email: "stranger@example.com", code: "123456" })
        .catch((e) => e);

      verification.isAuthorizedEmail.mockResolvedValueOnce(true);
      verification.verifyCode.mockResolvedValueOnce(false);
      const wrongCodeError = await controller
        .verifyCode({ email: "admin@example.com", code: "000000" })
        .catch((e) => e);

      expect(unauthorizedError).toBeInstanceOf(BadRequestException);
      expect(wrongCodeError).toBeInstanceOf(BadRequestException);
      expect((unauthorizedError as BadRequestException).getResponse()).toEqual(
        (wrongCodeError as BadRequestException).getResponse(),
      );
    });

    it("does not issue a session token when the email is unauthorized, even with a valid code", async () => {
      verification.isAuthorizedEmail.mockResolvedValue(false);
      verification.verifyCode.mockResolvedValue(true);

      await expect(
        controller.verifyCode({
          email: "stranger@example.com",
          code: "123456",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(verification.generateAdminSession).not.toHaveBeenCalled();
    });

    it("issues a session token only when both authorization and code check pass", async () => {
      verification.isAuthorizedEmail.mockResolvedValue(true);
      verification.verifyCode.mockResolvedValue(true);

      const result = await controller.verifyCode({
        email: "admin@example.com",
        code: "123456",
      });

      expect(result.success).toBe(true);
      expect(result.sessionToken).toBe("session-token-deadbeef");
      expect(verification.generateAdminSession).toHaveBeenCalledWith(
        "admin@example.com",
      );
    });

    it("rejects malformed code with BadRequestException before any DB lookup", async () => {
      await expect(
        controller.verifyCode({
          email: "admin@example.com",
          code: "12345",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(verification.verifyCode).not.toHaveBeenCalled();
      expect(verification.isAuthorizedEmail).not.toHaveBeenCalled();
    });
  });

  describe("assume-role", () => {
    const request = {
      userSession: { userId: "admin@example.com" },
    } as unknown as UserSessionRequest;

    it("resolves claims for the admin from the guard, not the body", async () => {
      await controller.assumeRole(request, {
        assignmentId: 7,
        role: "author",
      });
      expect(assumeRole.assumeRole).toHaveBeenCalledWith(
        "admin@example.com",
        7,
        "author",
      );
    });

    it.each([
      [{ assignmentId: "7", role: "learner" }],
      [{ assignmentId: 0, role: "learner" }],
      [{ assignmentId: 1.5, role: "learner" }],
      [{ assignmentId: 7, role: "admin" }],
      [{ assignmentId: 7 }],
      [undefined],
    ])("rejects malformed body %j", async (body) => {
      await expect(
        controller.assumeRole(request, body as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(assumeRole.assumeRole).not.toHaveBeenCalled();
    });

    it("only admits requests through AdminGuard", () => {
      const guards = Reflect.getMetadata(
        "__guards__",
        AdminAuthController.prototype.assumeRole,
      ) as unknown[];
      expect(guards).toContain(AdminGuard);
    });
  });
});
