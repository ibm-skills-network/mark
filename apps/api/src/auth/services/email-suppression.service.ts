import { Injectable, Logger } from "@nestjs/common";
import { EmailSuppression, EmailSuppressionReason } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";

const MAX_DETAIL_LENGTH = 500;

/**
 * Addresses Mark must not email again: permanent bounces recorded at send
 * time, complaints, and addresses an admin suppressed by hand. Event
 * Notifications keeps no suppression list of its own, so this replaces the
 * one SendGrid kept for us.
 */
@Injectable()
export class EmailSuppressionService {
  private readonly logger = new Logger(EmailSuppressionService.name);

  constructor(private readonly prisma: PrismaService) {}

  static normalize(email: string): string {
    return email.trim().toLowerCase();
  }

  /**
   * Fails open: if the lookup itself errors, the send goes ahead. A missed
   * suppression costs one email, while failing closed would stop admin
   * sign-in codes whenever the database hiccups.
   */
  async isSuppressed(email: string): Promise<boolean> {
    try {
      const row = await this.prisma.emailSuppression.findUnique({
        where: { email: EmailSuppressionService.normalize(email) },
        select: { id: true },
      });
      return row !== null;
    } catch (error) {
      this.logger.error(
        "email.suppression.lookup_failed; sending anyway",
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }

  /**
   * Records a suppression. An address that is already suppressed keeps its
   * original reason and detail.
   */
  async suppress(
    email: string,
    reason: EmailSuppressionReason,
    detail: string | undefined,
    createdBy: string,
  ): Promise<EmailSuppression> {
    const normalized = EmailSuppressionService.normalize(email);
    const row = await this.prisma.emailSuppression.upsert({
      where: { email: normalized },
      create: {
        email: normalized,
        reason,
        detail: detail?.slice(0, MAX_DETAIL_LENGTH),
        createdBy,
      },
      update: {},
    });
    this.logger.warn(
      `email.suppression.added email=${normalized} reason=${row.reason} by=${createdBy}`,
    );
    return row;
  }

  async list(
    page: number,
    limit: number,
    search?: string,
  ): Promise<{ items: EmailSuppression[]; total: number }> {
    const where = search
      ? {
          email: {
            contains: EmailSuppressionService.normalize(search),
          },
        }
      : {};
    const [items, total] = await Promise.all([
      this.prisma.emailSuppression.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.emailSuppression.count({ where }),
    ]);
    return { items, total };
  }

  /** Returns false when no suppression has that id. */
  async remove(id: number, removedBy: string): Promise<boolean> {
    const { count } = await this.prisma.emailSuppression.deleteMany({
      where: { id },
    });
    if (count > 0) {
      this.logger.warn(`email.suppression.removed id=${id} by=${removedBy}`);
    }
    return count > 0;
  }
}
