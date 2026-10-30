import { createHash } from "node:crypto";

export const DAY_MS = 24 * 60 * 60 * 1000;
// Stay inside IBM's rolling retention boundary, including during pagination.
export const BOUNCE_REPLAY_WINDOW_MS = 30 * DAY_MS - 60 * 60_000;

export function bounceSource(): string | undefined {
  const {
    EMAIL_BOUNCE_INSTANCE_ID: instance,
    EMAIL_BOUNCE_SMTP_CONFIG_ID: configuration,
  } = process.env;
  return instance && configuration ? `${instance}/${configuration}` : undefined;
}

export interface BounceEvent {
  id: string;
  source: string;
  email: string;
  domain: string;
  reason: string;
  occurredAt: Date;
}

// Contract: IBM Node admin SDK BounceMetricItem. Deliberately require exact
// class names: arbitrary diagnostic text containing UNKNOWN_USER is not proof
// that IBM classified a mailbox as invalid.
export function parseBounce(row: unknown, source: string): BounceEvent {
  if (!row || typeof row !== "object")
    throw new Error("Invalid IBM bounce row");
  const value = row as Record<string, unknown>;
  if (
    typeof value.email_address !== "string" ||
    typeof value.timestamp !== "string" ||
    typeof value.error_message !== "string" ||
    typeof value.subject !== "string"
  )
    throw new Error("Invalid IBM bounce fields");
  const email = value.email_address.trim().toLowerCase();
  const occurredAt = new Date(value.timestamp);
  if (
    !/^[^\s",;<>@]+@[^\s",;<>@]+\.[^\s",;<>@]+$/.test(email) ||
    !Number.isFinite(occurredAt.getTime())
  ) {
    throw new Error("Invalid IBM bounce recipient or timestamp");
  }
  const reason = value.error_message.trim();
  // Hash the complete identity, but retain neither subjects nor relay IPs.
  const id = createHash("sha256")
    .update(
      JSON.stringify([
        source,
        email,
        occurredAt.toISOString(),
        reason,
        value.subject,
        value.ip_address ?? null,
        value.subscription_id ?? null,
      ]),
    )
    .digest("hex");
  return {
    id,
    source,
    email,
    domain: email.split("@")[1],
    reason: reason.slice(0, 500),
    occurredAt,
  };
}
