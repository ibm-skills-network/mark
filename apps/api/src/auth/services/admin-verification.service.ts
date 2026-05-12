import * as crypto from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { isAdminEmail } from "src/config/admin-emails";
import { PrismaService } from "src/database/prisma.service";
import { Logger } from "winston";

const ADMIN_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ACTIVE_SESSIONS_PER_EMAIL = 5;

@Injectable()
export class AdminVerificationService {
  private readonly logger: Logger;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({
      context: AdminVerificationService.name,
    });
  }

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
   * Generate an admin session token. Concurrent sessions per email are allowed
   * up to MAX_ACTIVE_SESSIONS_PER_EMAIL; oldest are evicted when the cap is
   * exceeded. The new token is created first so an in-flight request from the
   * same admin on another device cannot race with the eviction sweep.
   */
  async generateAdminSession(email: string): Promise<string> {
    const normalizedEmail = email.toLowerCase();
    const sessionToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + ADMIN_SESSION_TTL_MS);

    await this.prisma.adminSession.create({
      data: {
        email: normalizedEmail,
        sessionToken,
        expiresAt,
      },
    });

    const surplus = await this.prisma.adminSession.findMany({
      where: { email: normalizedEmail },
      orderBy: { createdAt: "desc" },
      skip: MAX_ACTIVE_SESSIONS_PER_EMAIL,
      select: { id: true },
    });

    if (surplus.length > 0) {
      await this.prisma.adminSession.deleteMany({
        where: { id: { in: surplus.map((s) => s.id) } },
      });
      this.logger.info("admin_session_evicted_over_cap", {
        email: normalizedEmail,
        evicted_count: surplus.length,
        cap: MAX_ACTIVE_SESSIONS_PER_EMAIL,
      });
    }

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

  /**
   * Revoke every active admin session for an email — used by "log out
   * everywhere" flows after a credential change or to reclaim a lost device.
   */
  async revokeAllSessionsForEmail(email: string): Promise<number> {
    const result = await this.prisma.adminSession.deleteMany({
      where: { email: email.toLowerCase() },
    });
    return result.count;
  }

  /**
   * TTL of admin sessions in milliseconds. Exposed so the controller can
   * return the same expiry the DB row uses.
   */
  static readonly ADMIN_SESSION_TTL_MS = ADMIN_SESSION_TTL_MS;
}
