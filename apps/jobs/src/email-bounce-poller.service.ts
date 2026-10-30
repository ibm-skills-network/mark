import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import axios from "axios";
import { PrismaService } from "../../api/src/database/prisma.service";
import { EmailSuppressionService } from "../../api/src/auth/services/email-suppression.service";
import { IbmBounceClient } from "../../api/src/auth/services/ibm-bounce-client";
import {
  bounceSource,
  BOUNCE_REPLAY_WINDOW_MS,
} from "../../api/src/auth/services/email-bounce-source";

const LEASE_MS = 5 * 60_000;

@Injectable()
export class EmailBouncePoller {
  private readonly logger = new Logger(EmailBouncePoller.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: IbmBounceClient,
    private readonly suppressions: EmailSuppressionService,
  ) {}

  @Cron("0 */15 * * * *")
  async poll(): Promise<void> {
    if (
      process.env.ENABLE_JOB_SCHEDULERS !== "true" ||
      process.env.EMAIL_BOUNCE_POLL_ENABLED !== "true"
    )
      return;
    const source = bounceSource();
    if (!source) {
      this.logger.error("email.bounce.poll_unconfigured");
      return;
    }
    const leaseToken = randomUUID();
    try {
      await this.prisma.emailBouncePollState.upsert({
        where: { source },
        create: { source },
        update: {},
      });
      const now = new Date();
      const lease = await this.prisma.emailBouncePollState.updateMany({
        where: {
          source,
          OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
        },
        data: { leaseToken, leaseUntil: new Date(now.getTime() + LEASE_MS) },
      });
      if (!lease.count) return;

      // Re-read the bounded reporting window to catch late arrivals and recover
      // after outages. Never advance a cursor past a partially processed page.
      const end = new Date(Math.floor((Date.now() - 60_000) / 1000) * 1000);
      // IBM also rejects a start older than 30 days at request time. Leave
      // headroom for the end lag, clock skew, and subsequent page requests.
      const start = new Date(end.getTime() - BOUNCE_REPLAY_WINDOW_MS);
      const before = await this.suppressions.bounceHealth();
      let offset = 0;
      for (let pageNumber = 0; ; pageNumber++) {
        if (pageNumber >= 1000)
          throw new Error("Bounce page safety limit exceeded");
        const renewed = await this.prisma.emailBouncePollState.updateMany({
          where: { source, leaseToken, leaseUntil: { gt: new Date() } },
          data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
        });
        if (!renewed.count) throw new Error("Bounce poll lease lost");
        const page = await this.client.page(source, start, end, offset);
        if (page.events.length === 0 && offset < page.total)
          throw new Error("Incomplete IBM bounce pagination");
        for (const event of page.events)
          await this.suppressions.recordBounce(event);
        offset += page.events.length;
        if (offset >= page.total) break;
        await delay(1000); // Avoid bursts against IBM's API edge.
      }
      const recoveryLease = await this.prisma.emailBouncePollState.updateMany({
        where: { source, leaseToken, leaseUntil: { gt: new Date() } },
        data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
      });
      if (!recoveryLease.count) throw new Error("Bounce poll lease lost");
      await this.suppressions.recoverAfterSweep(source, end);
      const after = await this.suppressions.bounceHealth();
      for (const domain of after.domains) {
        if (
          before.domains.find((previous) => previous.domain === domain.domain)
            ?.recipients !== domain.recipients
        ) {
          this.logger.warn(
            `email.bounce.domain_warning domain=${domain.domain} recipients=${domain.recipients}`,
          );
        }
      }
      await this.prisma.emailBouncePollState.updateMany({
        where: { source, leaseToken },
        data: {
          lastSuccessAt: new Date(),
          lastError: null,
          leaseToken: null,
          leaseUntil: null,
        },
      });
      this.logger.log(`email.bounce.poll_completed rows=${offset}`);
      if (after.senderWarning.active)
        await this.alertSenderFailure(source, after.senderWarning);
    } catch (error) {
      // Never log Axios errors wholesale: their config contains IAM credentials.
      const status = axios.isAxiosError(error)
        ? error.response?.status
        : undefined;
      const retryAfter = axios.isAxiosError(error)
        ? String(error.response?.headers?.["retry-after"] ?? "")
        : "";
      const retryDelay = /^\d+$/.test(retryAfter)
        ? Number(retryAfter) * 1000
        : Date.parse(retryAfter) - Date.now();
      const cooldown = Math.max(
        15 * 60_000,
        Number.isFinite(retryDelay) ? retryDelay : 0,
      );
      const message = status
        ? `IBM HTTP ${status}`
        : "Bounce polling failed; check configuration and API contract";
      this.logger.error(`email.bounce.poll_failed ${message}`);
      // Keep a cooldown rather than immediately retrying a failed/rate-limited
      // request on another worker. The next scheduled poll retries the window.
      await this.prisma.emailBouncePollState
        .updateMany({
          where: { source, leaseToken },
          data: {
            lastError: message,
            leaseToken: null,
            leaseUntil: new Date(Date.now() + cooldown),
          },
        })
        .catch(() => this.logger.error("email.bounce.status_update_failed"));
    }
  }

  private async alertSenderFailure(
    source: string,
    counts: { domains: number; recipients: number },
  ): Promise<void> {
    const now = new Date();
    try {
      const claimed = await this.prisma.emailBouncePollState.updateMany({
        where: {
          source,
          OR: [
            { lastSenderAlertAt: null },
            {
              lastSenderAlertAt: { lte: new Date(now.getTime() - 60 * 60_000) },
            },
          ],
        },
        data: { lastSenderAlertAt: now },
      });
      if (!claimed.count) return;
      this.logger.error(
        `email.bounce.sender_warning domains=${counts.domains} recipients=${counts.recipients} window=1h`,
      );
      const webhook = process.env.EMAIL_DELIVERY_ALERT_WEBHOOK_URL;
      if (!webhook) return; // Structured error can also feed the existing log alerting pipeline.
      const url = new URL(webhook);
      if (url.protocol !== "https:" || url.username || url.password)
        throw new Error("Invalid delivery alert webhook");
      await axios.post(
        webhook,
        {
          text: `Mark email delivery alert: ${counts.recipients} recipients across ${counts.domains} domains failed in the last hour. Temporary holds and recovery are automatic. Check the sender/relay configuration.`,
        },
        { timeout: 10_000, maxRedirects: 0 },
      );
    } catch {
      // Do not expose webhook credentials or mark a successful bounce sweep as
      // failed when the independent alert channel is unavailable.
      this.logger.error("email.bounce.sender_alert_failed");
      await this.prisma.emailBouncePollState
        .updateMany({
          where: { source, lastSenderAlertAt: now },
          data: { lastSenderAlertAt: null },
        })
        .catch(() =>
          this.logger.error("email.bounce.alert_status_update_failed"),
        );
    }
  }
}
