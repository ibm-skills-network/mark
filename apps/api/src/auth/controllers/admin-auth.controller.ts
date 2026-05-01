import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Inject,
  Injectable,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { sanitizeForLog } from "../../logger/sanitize";
import { AdminEmailService } from "../services/admin-email.service";
import { AdminVerificationService } from "../services/admin-verification.service";

interface SendCodeRequest {
  email: string;
}

interface VerifyCodeRequest {
  email: string;
  code: string;
}

interface SendCodeResponse {
  message: string;
  success: boolean;
}

interface VerifyCodeResponse {
  message: string;
  success: boolean;
  sessionToken?: string;
  expiresAt?: string;
}

@ApiTags("Admin Authentication")
@Injectable()
@UseGuards(ThrottlerGuard)
@Controller({
  path: "auth/admin",
  version: "1",
})
export class AdminAuthController {
  private readonly logger: Logger;

  constructor(
    private readonly adminVerificationService: AdminVerificationService,
    private readonly adminEmailService: AdminEmailService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger
  ) {
    this.logger = parentLogger.child({ context: AdminAuthController.name });
  }

  @Post("me")
  @ApiOperation({
    summary: "Get current admin user information",
    description: "Returns the current admin user's role and email information",
  })
  @ApiResponse({
    status: 200,
    description: "Admin user information retrieved successfully",
  })
  @ApiResponse({
    status: 401,
    description: "Invalid or expired admin session",
  })
  async getCurrentAdmin(@Body() body: { sessionToken: string }) {
    const userInfo = await this.adminVerificationService.verifyAdminSession(
      body.sessionToken
    );

    if (!userInfo) {
      throw new ForbiddenException("Invalid or expired admin session");
    }

    return {
      email: userInfo.email,
      role: userInfo.role,
      isAdmin: userInfo.role === "admin",
      success: true,
    };
  }

  // 5 requests / 60s / IP. send-code mails a verification code (SMTP cost +
  // user-inbox impact) and is the only entry point for the admin auth flow,
  // so it gets the strict tier.
  @Throttle({ strict: { limit: 5, ttl: 60_000 } })
  @Post("send-code")
  @ApiOperation({
    summary: "Send verification code to admin email",
    description:
      "Always returns 200 with a generic message regardless of whether the email is authorized — this avoids leaking the admin allowlist to anonymous probes. If the email is authorized, a 6-digit code is emailed.",
  })
  @ApiResponse({
    status: 200,
    description: "Generic acknowledgement (does not confirm authorization)",
    type: Object,
  })
  @ApiResponse({
    status: 400,
    description: "Invalid email format",
  })
  async sendVerificationCode(
    @Body() request: SendCodeRequest
  ): Promise<SendCodeResponse> {
    const { email } = request;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new BadRequestException("Invalid email format");
    }

    // Generic ack returned on every code path so an anonymous caller
    // cannot distinguish authorized from unauthorized emails.
    const genericResponse: SendCodeResponse = {
      message: "If the email is authorized, a verification code has been sent.",
      success: true,
    };

    try {
      const isAuthorized =
        await this.adminVerificationService.isAuthorizedEmail(email);

      if (!isAuthorized) {
        this.logger.info("admin_send_code_unauthorized_email", {
          email: sanitizeForLog(email),
        });
        return genericResponse;
      }

      const code = await this.adminVerificationService.generateAndStoreCode(
        email
      );

      const emailSent = await this.adminEmailService.sendVerificationCode(
        email,
        code
      );

      if (!emailSent) {
        // SMTP failure surfaces only in logs — the client cannot tell
        // a delivery failure from an unauthorized email.
        this.logger.error("admin_send_code_smtp_failed", {
          email: sanitizeForLog(email),
        });
      }

      return genericResponse;
    } catch (error) {
      this.logger.error("admin_send_code_unexpected_error", {
        email: sanitizeForLog(email),
        error: error instanceof Error ? error.message : "unknown",
      });
      return genericResponse;
    }
  }

  // 10 requests / 60s / IP. The 6-digit code has 10^6 combinations and a
  // 10-minute validity window — at 10 attempts/min/IP a single attacker
  // exhausts ~6_000 codes per window vs. ~10^6 needed, so brute force at
  // any practical scale becomes infeasible without distributed sources.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("verify-code")
  @ApiOperation({
    summary: "Verify admin access code",
    description:
      "Verifies the 6-digit code and returns a session token. Returns the same generic 400 for unauthorized email, unknown code, expired code, or already-used code so the response cannot be used to enumerate the admin allowlist.",
  })
  @ApiResponse({
    status: 200,
    description: "Code verified successfully, session token returned",
    type: Object,
  })
  @ApiResponse({
    status: 400,
    description:
      "Invalid or expired code, or the email is not authorized (response does not distinguish)",
  })
  async verifyCode(
    @Body() request: VerifyCodeRequest
  ): Promise<VerifyCodeResponse> {
    const { email, code } = request;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new BadRequestException("Invalid email format");
    }

    if (!/^\d{6}$/.test(code)) {
      throw new BadRequestException("Invalid code format");
    }

    const genericInvalid = new BadRequestException(
      "Invalid or expired verification code"
    );

    try {
      // Run authorization + code lookup unconditionally so the response
      // shape and timing do not differ between unauthorized email and
      // wrong code. Both must succeed to issue a session.
      const [isAuthorized, isValidCode] = await Promise.all([
        this.adminVerificationService.isAuthorizedEmail(email),
        this.adminVerificationService.verifyCode(email, code),
      ]);

      if (!isAuthorized) {
        this.logger.info("admin_verify_code_unauthorized_email", {
          email: sanitizeForLog(email),
        });
        throw genericInvalid;
      }

      if (!isValidCode) {
        this.logger.info("admin_verify_code_invalid", {
          email: sanitizeForLog(email),
        });
        throw genericInvalid;
      }

      const sessionToken =
        await this.adminVerificationService.generateAdminSession(email);
      const expiresAt = new Date(
        Date.now() + AdminVerificationService.ADMIN_SESSION_TTL_MS
      ).toISOString();

      return {
        message: "Admin access granted",
        success: true,
        sessionToken,
        expiresAt,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error("admin_verify_code_unexpected_error", {
        email: sanitizeForLog(email),
        error: error instanceof Error ? error.message : "unknown",
      });
      throw genericInvalid;
    }
  }

  @Post("logout")
  @ApiOperation({
    summary: "Logout admin session",
    description: "Revokes the admin session token",
  })
  @ApiResponse({
    status: 200,
    description: "Logged out successfully",
  })
  async logout(
    @Body() request: { sessionToken: string }
  ): Promise<{ message: string }> {
    const { sessionToken } = request;

    if (!sessionToken) {
      throw new BadRequestException("Session token is required");
    }

    try {
      await this.adminVerificationService.revokeSession(sessionToken);
      return { message: "Logged out successfully" };
    } catch {
      throw new BadRequestException("Failed to logout");
    }
  }

  // 5 requests / 60s / IP. logout-all is session-mutating and a denial
  // primitive against a legitimate admin if abused.
  @Throttle({ strict: { limit: 5, ttl: 60_000 } })
  @Post("logout-all")
  @ApiOperation({
    summary: "Logout every admin session for the current admin",
    description:
      "Revokes every active admin session that belongs to the same email as the supplied session token.",
  })
  @ApiResponse({ status: 200, description: "All sessions revoked" })
  @ApiResponse({ status: 403, description: "Invalid or expired admin session" })
  async logoutAll(
    @Body() request: { sessionToken: string }
  ): Promise<{ message: string; revokedCount: number }> {
    const { sessionToken } = request;

    if (!sessionToken) {
      throw new BadRequestException("Session token is required");
    }

    const userInfo = await this.adminVerificationService.verifyAdminSession(
      sessionToken
    );
    if (!userInfo) {
      throw new ForbiddenException("Invalid or expired admin session");
    }

    const revokedCount =
      await this.adminVerificationService.revokeAllSessionsForEmail(
        userInfo.email
      );

    return {
      message: "All admin sessions revoked",
      revokedCount,
    };
  }

  @Post("test-email")
  @ApiOperation({
    summary: "Test email configuration",
    description:
      "Send a test email to verify Gmail SMTP configuration is working",
  })
  @ApiResponse({
    status: 200,
    description: "Test email sent successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Failed to send test email",
  })
  async testEmail(
    @Body() request: { email: string }
  ): Promise<{ message: string; success: boolean }> {
    const { email } = request;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new BadRequestException("Invalid email format");
    }

    try {
      const connectionOk = await this.adminEmailService.testConnection();
      if (!connectionOk) {
        throw new BadRequestException("Email service not properly configured");
      }

      const emailSent = await this.adminEmailService.sendTestEmail(email);
      if (!emailSent) {
        throw new BadRequestException("Failed to send test email");
      }

      return {
        message: "Test email sent successfully",
        success: true,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException("Failed to send test email");
    }
  }
}
