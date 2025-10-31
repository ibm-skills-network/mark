import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Injectable,
  Post,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
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
@Controller({
  path: "auth/admin",
  version: "1",
})
export class AdminAuthController {
  constructor(
    private readonly adminVerificationService: AdminVerificationService,
    private readonly adminEmailService: AdminEmailService,
  ) {}

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
      body.sessionToken,
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

  @Post("send-code")
  @ApiOperation({
    summary: "Send verification code to admin email",
    description:
      "Sends a 6-digit verification code to the specified email if it's in the admin list",
  })
  @ApiResponse({
    status: 200,
    description: "Verification code sent successfully",
    type: Object,
  })
  @ApiResponse({
    status: 403,
    description: "Email not authorized for admin access",
  })
  @ApiResponse({
    status: 400,
    description: "Invalid email format",
  })
  async sendVerificationCode(
    @Body() request: SendCodeRequest,
  ): Promise<SendCodeResponse> {
    const { email } = request;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new BadRequestException("Invalid email format");
    }

    const isAuthorized =
      await this.adminVerificationService.isAuthorizedEmail(email);
    if (!isAuthorized) {
      throw new ForbiddenException("Email not authorized for admin access");
    }

    try {
      const code =
        await this.adminVerificationService.generateAndStoreCode(email);

      const emailSent = await this.adminEmailService.sendVerificationCode(
        email,
        code,
      );

      if (!emailSent) {
        throw new BadRequestException("Failed to send verification code");
      }

      return {
        message: "Verification code sent to your email",
        success: true,
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw new BadRequestException("Failed to send verification code");
    }
  }

  @Post("verify-code")
  @ApiOperation({
    summary: "Verify admin access code",
    description:
      "Verifies the 6-digit code and returns a session token for admin access",
  })
  @ApiResponse({
    status: 200,
    description: "Code verified successfully, session token returned",
    type: Object,
  })
  @ApiResponse({
    status: 400,
    description: "Invalid or expired code",
  })
  @ApiResponse({
    status: 403,
    description: "Email not authorized",
  })
  async verifyCode(
    @Body() request: VerifyCodeRequest,
  ): Promise<VerifyCodeResponse> {
    const { email, code } = request;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new BadRequestException("Invalid email format");
    }

    if (!/^\d{6}$/.test(code)) {
      throw new BadRequestException("Invalid code format");
    }

    const isAuthorized =
      await this.adminVerificationService.isAuthorizedEmail(email);
    if (!isAuthorized) {
      throw new ForbiddenException("Email not authorized for admin access");
    }

    try {
      const isValidCode = await this.adminVerificationService.verifyCode(
        email,
        code,
      );

      if (!isValidCode) {
        throw new BadRequestException("Invalid or expired verification code");
      }

      const sessionToken =
        await this.adminVerificationService.generateAdminSession(email);
      const expiresAt = new Date(
        Date.now() + 24 * 60 * 60 * 1000,
      ).toISOString();

      return {
        message: "Admin access granted",
        success: true,
        sessionToken,
        expiresAt,
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw new BadRequestException("Failed to verify code");
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
    @Body() request: { sessionToken: string },
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
    @Body() request: { email: string },
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
