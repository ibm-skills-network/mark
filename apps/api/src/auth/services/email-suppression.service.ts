import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  EmailSuppression,
  EmailSuppressionReason,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { BounceEvent, bounceSource, DAY_MS } from "./email-bounce-source";

const MAX_DETAIL_LENGTH = 500;
const HOLD_DAYS = [1, 3, 7];

export type RecoveryPermit =
  | { allowed: true; probeToken?: string }
  | {
      allowed: false;
      reason: "suppressed" | "temporary_hold" | "recovery_unavailable";
    };

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

  /** Atomically admits one naturally triggered email after a temporary hold. */
  async acquireRecoveryPermit(email: string): Promise<RecoveryPermit> {
    const source = bounceSource();
    if (!source) return { allowed: true };
    const normalized = EmailSuppressionService.normalize(email);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(68301828)`;
        if (
          await transaction.emailSuppression.findUnique({
            where: { email: normalized },
          })
        ) {
          return { allowed: false, reason: "suppressed" };
        }
        const hold = await transaction.emailDeliveryHold.findUnique({
          where: { email: normalized },
        });
        if (!hold || hold.source !== source || hold.recoveredAt)
          return { allowed: true };
        const now = new Date();
        if (hold.holdUntil > now || hold.probeStartedAt)
          return { allowed: false, reason: "temporary_hold" };
        // Do not start trials while bounce monitoring is down or rate-limited.
        const state = await transaction.emailBouncePollState.findUnique({
          where: { source },
        });
        if (
          !state?.lastSuccessAt ||
          state.lastError ||
          now.getTime() - state.lastSuccessAt.getTime() > 45 * 60_000
        ) {
          return { allowed: false, reason: "recovery_unavailable" };
        }
        const probeToken = randomUUID();
        await transaction.emailDeliveryHold.update({
          where: { email: normalized },
          data: { probeToken, probeStartedAt: now, probeAcceptedAt: null },
        });
        return { allowed: true, probeToken };
      });
    } catch {
      // Unlike the legacy permanent-list lookup, a failed probe reservation
      // must not allow concurrent retries to bypass the one-message limit.
      this.logger.error("email.recovery.reservation_failed");
      return { allowed: false, reason: "recovery_unavailable" };
    }
  }

  async finishRecoveryProbe(
    email: string,
    probeToken: string,
    accepted: boolean,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(68301828)`;
        await transaction.emailDeliveryHold.updateMany({
          where: {
            email: EmailSuppressionService.normalize(email),
            probeToken,
            recoveredAt: null,
          },
          data: accepted
            ? { probeAcceptedAt: new Date() }
            : {
                holdUntil: new Date(Date.now() + DAY_MS),
                probeToken: null,
                probeStartedAt: null,
                probeAcceptedAt: null,
              },
        });
      });
    } catch {
      // A lost result leaves the reservation pending; a healthy sweep releases
      // abandoned reservations after 24h without claiming delivery succeeded.
      this.logger.error("email.recovery.result_record_failed");
    }
  }

  /** Only called after all pages of a complete bounce sweep were processed. */
  async recoverAfterSweep(source: string, end: Date): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(68301828)`;
      const observedThrough = new Date(end.getTime() - DAY_MS);
      // Acceptance only starts observation; it is not a delivery receipt.
      await transaction.emailDeliveryHold.updateMany({
        where: {
          source,
          recoveredAt: null,
          probeAcceptedAt: { lte: observedThrough },
          probeStartedAt: { gte: new Date(end.getTime() - 30 * DAY_MS) },
        },
        data: { recoveredAt: end, probeToken: null },
      });
      await transaction.emailDeliveryHold.updateMany({
        where: {
          source,
          recoveredAt: null,
          OR: [
            { probeAcceptedAt: null, probeStartedAt: { lte: observedThrough } },
            { probeStartedAt: { lt: new Date(end.getTime() - 30 * DAY_MS) } },
          ],
        },
        data: {
          holdUntil: end,
          probeToken: null,
          probeStartedAt: null,
          probeAcceptedAt: null,
        },
      });
    });
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
    const row = await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(68301828)`;
      const suppression = await transaction.emailSuppression.upsert({
        where: { email: normalized },
        create: {
          email: normalized,
          reason,
          detail: detail?.slice(0, MAX_DETAIL_LENGTH),
          createdBy,
        },
        update: {},
      });
      await transaction.emailDeliveryHold.deleteMany({
        where: { email: normalized },
      });
      return suppression;
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
      await transaction.emailDeliveryHold.deleteMany({
        where: { email: row.email },
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
      // Re-evaluate temporary policy for existing rows too: the first sweep
      // after upgrading should protect recipients already in bounce history.
      // Counts still come from the deduplicated event ledger.
      if (!inserted.count && event.reason === "UNKNOWN_USER") return;
      const release = await transaction.emailSuppressionRelease.findUnique({
        where: { email: event.email },
      });
      if (release && event.occurredAt <= release.releasedAt) return;
      if (event.reason !== "UNKNOWN_USER") {
        await this.applyTemporaryHold(transaction, event, release?.releasedAt);
        return;
      }
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
      await transaction.emailDeliveryHold.deleteMany({
        where: { email: event.email },
      });
    });
  }

  private async applyTemporaryHold(
    transaction: Prisma.TransactionClient,
    event: BounceEvent,
    releasedAt?: Date,
  ): Promise<void> {
    const now = new Date();
    if (
      await transaction.emailSuppression.findUnique({
        where: { email: event.email },
      })
    )
      return;
    const hold = await transaction.emailDeliveryHold.findUnique({
      where: { email: event.email },
    });
    const retained =
      hold?.source === event.source &&
      (!hold.recoveredAt ||
        now.getTime() - hold.lastFailureAt.getTime() < 30 * DAY_MS);
    if (retained) {
      if (event.occurredAt <= hold.lastFailureAt) return;
      if (!hold.probeStartedAt || event.occurredAt < hold.probeStartedAt) {
        // More reports from messages already in flight must not turn one
        // incident into several escalation stages or keep extending the hold.
        if (!hold.recoveredAt)
          await transaction.emailDeliveryHold.update({
            where: { email: event.email },
            data: { lastFailureAt: event.occurredAt },
          });
        return;
      }
    } else {
      if (event.occurredAt < new Date(now.getTime() - 7 * DAY_MS)) return;
      const since = new Date(
        Math.max(now.getTime() - 7 * DAY_MS, releasedAt?.getTime() ?? 0),
      );
      const failures = await transaction.emailBounceEvent.count({
        where: {
          source: event.source,
          email: event.email,
          reason: { not: "UNKNOWN_USER" },
          occurredAt: { gt: since, lte: now },
        },
      });
      if (failures < 2) return;
    }
    const stage = retained ? Math.min(hold.stage + 1, HOLD_DAYS.length) : 1;
    const data = {
      source: event.source,
      stage,
      reason: event.reason,
      holdUntil: new Date(now.getTime() + HOLD_DAYS[stage - 1] * DAY_MS),
      lastFailureAt: event.occurredAt,
      probeToken: null,
      probeStartedAt: null,
      probeAcceptedAt: null,
      recoveredAt: null,
    };
    await transaction.emailDeliveryHold.upsert({
      where: { email: event.email },
      create: { email: event.email, ...data },
      update: data,
    });
  }

  async listTemporaryHolds(page: number, limit: number, search?: string) {
    const source = bounceSource();
    if (!source) return { items: [], total: 0 };
    const where = {
      source,
      recoveredAt: null,
      ...(search
        ? { email: { contains: EmailSuppressionService.normalize(search) } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.emailDeliveryHold.findMany({
        where,
        orderBy: { lastFailureAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          email: true,
          stage: true,
          reason: true,
          holdUntil: true,
          probeStartedAt: true,
          probeAcceptedAt: true,
        },
      }),
      this.prisma.emailDeliveryHold.count({ where }),
    ]);
    return { items, total };
  }

  async releaseTemporaryHold(
    email: string,
    releasedBy: string,
  ): Promise<boolean> {
    const normalized = EmailSuppressionService.normalize(email);
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(68301828)`;
      const deleted = await transaction.emailDeliveryHold.deleteMany({
        where: { email: normalized, source: bounceSource() ?? "" },
      });
      if (!deleted.count) return false;
      const releasedAt = new Date();
      await transaction.emailSuppressionRelease.upsert({
        where: { email: normalized },
        create: { email: normalized, releasedAt, releasedBy },
        update: { releasedAt, releasedBy },
      });
      this.logger.warn(
        `email.recovery.released email=${normalized} by=${releasedBy}`,
      );
      return true;
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
        senderWarning: { active: false, domains: 0, recipients: 0 },
      };
    const now = new Date();
    const since = new Date(now.getTime() - 7 * DAY_MS);
    // Prisma stores DateTime as UTC timestamp without time zone. Cast ISO
    // strings explicitly so raw-query parameters cannot pick up the DB's zone.
    const [state, domains, senderCounts] = await Promise.all([
      this.prisma.emailBouncePollState.findUnique({ where: { source } }),
      this.prisma.$queryRaw<
        { domain: string; recipients: number; lastBounceAt: Date }[]
      >`
        SELECT "domain", COUNT(DISTINCT "email")::int AS "recipients", MAX("occurredAt") AS "lastBounceAt"
        FROM "EmailBounceEvent"
        WHERE "source" = ${source}
          AND "occurredAt" >= ${since.toISOString()}::timestamp
          AND "occurredAt" <= ${now.toISOString()}::timestamp
          AND "reason" <> 'UNKNOWN_USER'
        GROUP BY "domain" HAVING COUNT(DISTINCT "email") >= 3
        ORDER BY "recipients" DESC, "domain" ASC
      `,
      this.prisma.$queryRaw<{ domains: number; recipients: number }[]>`
        SELECT COUNT(DISTINCT "domain")::int AS "domains", COUNT(DISTINCT "email")::int AS "recipients"
        FROM "EmailBounceEvent" WHERE "source" = ${source} AND "reason" <> 'UNKNOWN_USER'
          AND "occurredAt" >= ${new Date(now.getTime() - 60 * 60_000).toISOString()}::timestamp
          AND "occurredAt" <= ${now.toISOString()}::timestamp
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
      senderWarning: {
        ...senderCounts[0],
        active:
          senderCounts[0].domains >= 3 && senderCounts[0].recipients >= 10,
      },
    };
  }
}
