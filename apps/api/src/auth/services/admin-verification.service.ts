import * as crypto from "node:crypto";
import { Injectable } from "@nestjs/common";
import { isAdminEmail } from "src/config/admin-emails";
import { PrismaService } from "src/database/prisma.service";

@Injectable()
export class AdminVerificationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generate a 6-digit verification code
   */
  private generateVerificationCode(): string {
    return crypto.randomInt(100_000, 999_999).toString();
  }

  /**
   * Generate a verification code and store it in the database
   */
  async generateAndStoreCode(email: string): Promise<string> {
    const code = this.generateVerificationCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await this.prisma.adminVerificationCode.deleteMany({
      where: { email: email.toLowerCase() },
    });

    await this.prisma.adminVerificationCode.create({
      data: {
        email: email.toLowerCase(),
        code,
        expiresAt,
        used: false,
      },
    });

    return code;
  }

  /**
   * Verify a code against stored codes
   */
  async verifyCode(email: string, code: string): Promise<boolean> {
    const verificationRecord =
      await this.prisma.adminVerificationCode.findFirst({
        where: {
          email: email.toLowerCase(),
          code,
          used: false,
          expiresAt: {
            gt: new Date(),
          },
        },
      });

    if (!verificationRecord) {
      return false;
    }

    await this.prisma.adminVerificationCode.update({
      where: { id: verificationRecord.id },
      data: { used: true },
    });

    return true;
  }

  /**
   * Generate an admin session token
   */
  async generateAdminSession(email: string): Promise<string> {
    const sessionToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await this.prisma.adminSession.deleteMany({
      where: { email: email.toLowerCase() },
    });

    await this.prisma.adminSession.create({
      data: {
        email: email.toLowerCase(),
        sessionToken,
        expiresAt,
      },
    });

    return sessionToken;
  }

  /**
   * Verify admin session token and return user info
   */
  async verifyAdminSession(
    sessionToken: string,
  ): Promise<{ email: string; role: "admin" | "author" } | null> {
    const session = await this.prisma.adminSession.findFirst({
      where: {
        sessionToken,
        expiresAt: {
          gt: new Date(),
        },
      },
    });

    if (!session) {
      return null;
    }

    const role = isAdminEmail(session.email) ? "admin" : "author";

    return {
      email: session.email,
      role,
    };
  }

  /**
   * Check if email is authorized (admin or has authored assignments)
   */
  async isAuthorizedEmail(email: string): Promise<boolean> {
    if (isAdminEmail(email)) {
      return true;
    }

    const authorRecord = await this.prisma.assignmentAuthor.findFirst({
      where: {
        userId: email.toLowerCase(),
      },
    });

    return !!authorRecord;
  }

  /**
   * Clean up expired codes and sessions
   */
  async cleanupExpired(): Promise<void> {
    const now = new Date();

    await Promise.all([
      this.prisma.adminVerificationCode.deleteMany({
        where: {
          expiresAt: {
            lt: now,
          },
        },
      }),
      this.prisma.adminSession.deleteMany({
        where: {
          expiresAt: {
            lt: now,
          },
        },
      }),
    ]);
  }

  /**
   * Revoke admin session
   */
  async revokeSession(sessionToken: string): Promise<void> {
    await this.prisma.adminSession.deleteMany({
      where: { sessionToken },
    });
  }
}
