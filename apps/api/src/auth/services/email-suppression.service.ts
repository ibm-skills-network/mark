import { Injectable, Logger } from "@nestjs/common";
import { EmailSuppression, EmailSuppressionReason } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { BounceEvent, bounceSource, DAY_MS } from "./email-bounce-source";

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
    const count = await this.prisma.$transaction(async (transaction) => {
      // Shared with ingestion, so a release cannot race a late bounce report.
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(68301828)`;
      const row = await transaction.emailSuppression.findUnique({
        where: { id },
      });
      if (!row) return 0;
      const releasedAt = new Date();
      await transaction.emailSuppressionRelease.upsert({
        where: { email: row.email },
        create: { email: row.email, releasedAt, releasedBy: removedBy },
        update: { releasedAt, releasedBy: removedBy },
      });
      const deleted = await transaction.emailSuppression.deleteMany({
        where: { id },
      });
      return deleted.count;
    });
    if (count > 0) {
      this.logger.warn(`email.suppression.removed id=${id} by=${removedBy}`);
    }
    return count > 0;
  }

  async recordBounce(event: BounceEvent): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(68301828)`;
      const inserted = await transaction.emailBounceEvent.createMany({
        data: [event],
        skipDuplicates: true,
      });
      if (!inserted.count || event.reason !== "UNKNOWN_USER") return;
      const release = await transaction.emailSuppressionRelease.findUnique({
        where: { email: event.email },
      });
      if (release && event.occurredAt <= release.releasedAt) return;
      await transaction.emailSuppression.upsert({
        where: { email: event.email },
        create: {
          email: event.email,
          reason: EmailSuppressionReason.HARD_BOUNCE,
          detail: `IBM UNKNOWN_USER at ${event.occurredAt.toISOString()}; event=${event.id}`,
          createdBy: "system:ibm-bounce",
        },
        update: {},
      });
    });
  }

  async bounceHealth() {
    const source = bounceSource();
    if (!source)
      return {
        configured: false,
        lastSuccessAt: null,
        lastError: null,
        stale: true,
        domains: [],
      };
    const now = new Date();
    const since = new Date(now.getTime() - 7 * DAY_MS);
    // Prisma stores DateTime as UTC timestamp without time zone. Cast ISO
    // strings explicitly so raw-query parameters cannot pick up the DB's zone.
    const [state, domains] = await Promise.all([
      this.prisma.emailBouncePollState.findUnique({ where: { source } }),
      this.prisma.$queryRaw<
        { domain: string; recipients: number; lastBounceAt: Date }[]
      >`
        SELECT "domain", COUNT(DISTINCT "email")::int AS "recipients", MAX("occurredAt") AS "lastBounceAt"
        FROM "EmailBounceEvent"
        WHERE "source" = ${source}
          AND "occurredAt" >= ${since.toISOString()}::timestamp
          AND "occurredAt" <= ${now.toISOString()}::timestamp
          AND "reason" IN ('MESSAGE_REFUSED', 'UNKNOWN_ERROR')
        GROUP BY "domain" HAVING COUNT(DISTINCT "email") >= 3
        ORDER BY "recipients" DESC, "domain" ASC
      `,
    ]);
    return {
      configured: true,
      lastSuccessAt: state?.lastSuccessAt ?? null,
      lastError: state?.lastError ?? null,
      stale:
        !state?.lastSuccessAt ||
        now.getTime() - state.lastSuccessAt.getTime() > 45 * 60_000,
      domains,
    };
  }
}
