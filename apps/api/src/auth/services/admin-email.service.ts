import { Injectable, Logger } from "@nestjs/common";
import { EmailSuppressionReason } from "@prisma/client";
import * as nodemailer from "nodemailer";
import { EmailSuppressionService } from "./email-suppression.service";

/**
 * Sends Mark's transactional email over SMTP, through IBM Cloud Event
 * Notifications in staging and production.
 *
 * Configured via environment variables:
 *   SMTP_HOST        SMTP server (default: the Event Notifications endpoint)
 *   SMTP_PORT        587 for STARTTLS (default) or 465 for implicit TLS
 *   SMTP_USER        SMTP username; sending is enabled once user and password are set
 *   SMTP_PASSWORD    SMTP password (for Event Notifications, an IAM API key)
 *   EMAIL_FROM       sender address on a verified domain (default noreply@skills.network)
 *   EMAIL_FROM_NAME  sender name (default Mark)
 *   EMAIL_HELP_URL   where recipients get help (default https://support.skills.network)
 *
 * Without SMTP credentials, emails are logged to the console in development
 * and dropped, with an error, in production.
 *
 * Every send is checked against the suppression list first, and an address
 * the receiving server rejects as permanently undeliverable is added to it.
 */

interface EmailContent {
  to: string;
  subject: string;
  /** Heading for the HTML <title>. */
  title: string;
  /** HTML body, without the shared layout or footer. */
  html: string;
  /** Plain-text body, without the shared footer. */
  text: string;
}

interface OutgoingMessage {
  from: { name: string; address: string };
  to: string;
  subject: string;
  html: string;
  text: string;
}

// nodemailer ships no type definitions, so type the small surface we use.
interface MailTransport {
  sendMail(message: OutgoingMessage): Promise<unknown>;
  verify(): Promise<unknown>;
}

const mailer = nodemailer as {
  createTransport(config: {
    host: string;
    port: number;
    secure: boolean;
    requireTLS: boolean;
    auth: { user: string; pass: string };
  }): MailTransport;
};

interface SmtpError {
  responseCode?: number;
  response?: string;
  command?: string;
}

const DEFAULT_SMTP_HOST = "smtp.us-south.event-notifications.cloud.ibm.com";
const DEFAULT_SMTP_PORT = 587;
const DEFAULT_FROM_EMAIL = "noreply@skills.network";
const DEFAULT_FROM_NAME = "Mark";
const DEFAULT_HELP_URL = "https://support.skills.network";

// One address, no display name, no list separators. Every Mark email goes to
// exactly one recipient.
const SINGLE_ADDRESS = /^[^\s",;<>@]+@[^\s",;<>@]+\.[^\s",;<>@]+$/;

// Enhanced status codes (RFC 3463) that mean the address itself is bad:
// 5.1.x (no such user, bad domain, bad syntax) and 5.2.1 (mailbox disabled).
// Policy and relay rejections (5.7.x) are not about the recipient and must
// never suppress anyone, or one misconfiguration would suppress everybody.
const PERMANENT_RECIPIENT_STATUS = /\b5\.(1\.\d{1,3}|2\.1)\b/;

@Injectable()
export class AdminEmailService {
  private readonly logger = new Logger(AdminEmailService.name);
  private transporter?: MailTransport;
  private readonly from = {
    name: process.env.EMAIL_FROM_NAME || DEFAULT_FROM_NAME,
    address: process.env.EMAIL_FROM || DEFAULT_FROM_EMAIL,
  };
  private readonly helpUrl = process.env.EMAIL_HELP_URL || DEFAULT_HELP_URL;

  constructor(private readonly suppressions: EmailSuppressionService) {
    this.configureTransport();
  }

  private configureTransport(): void {
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASSWORD;
    if (!user || !pass) {
      const message =
        "SMTP_USER/SMTP_PASSWORD not set; Mark email is disabled. Emails are logged to the console in development.";
      if (process.env.NODE_ENV === "production") {
        this.logger.error(message);
      } else {
        this.logger.warn(message);
      }
      return;
    }

    const host = process.env.SMTP_HOST || DEFAULT_SMTP_HOST;
    const parsedPort = Number.parseInt(process.env.SMTP_PORT ?? "", 10);
    const port = Number.isInteger(parsedPort) ? parsedPort : DEFAULT_SMTP_PORT;
    const secure = port === 465;
    this.transporter = mailer.createTransport({
      host,
      port,
      secure,
      // On 587 the session must upgrade with STARTTLS; never send in clear.
      requireTLS: !secure,
      auth: { user, pass },
    });
    this.logger.log(
      `Email service using SMTP host=${host} port=${port} from=${this.from.address}`,
    );
  }

  /**
   * Returns true only when the SMTP server accepted the message (or, in
   * development without SMTP, when it was logged). Every reason for not
   * sending is logged here, so callers only need to log the outcome.
   */
  private async send(email: EmailContent): Promise<boolean> {
    const to = email.to.trim();
    if (!SINGLE_ADDRESS.test(to)) {
      this.logger.warn(
        `email.skipped.invalid_recipient subject="${email.subject}"`,
      );
      return false;
    }

    if (await this.suppressions.isSuppressed(to)) {
      this.logger.warn(
        `email.skipped.suppressed to=${to} subject="${email.subject}"`,
      );
      return false;
    }

    const message: OutgoingMessage = {
      from: this.from,
      to,
      subject: email.subject,
      html: this.layout(email.title, email.html),
      text: `${email.text}\n\n${this.textFooter()}`,
    };

    if (!this.transporter) {
      if (process.env.NODE_ENV === "production") {
        this.logger.error(
          `email.not_sent.not_configured to=${to} subject="${email.subject}"`,
        );
        return false;
      }
      this.logger.log(
        `Email (SMTP not configured)\nTo: ${to}\nSubject: ${message.subject}\n\n${message.text}`,
      );
      return true;
    }

    try {
      await this.transporter.sendMail(message);
      this.logger.log(`email.sent to=${to} subject="${email.subject}"`);
      return true;
    } catch (error) {
      this.logger.error(
        `email.failed to=${to} subject="${email.subject}"`,
        error instanceof Error ? error.stack : String(error),
      );
      await this.suppressIfPermanent(to, error);
      return false;
    }
  }

  private async suppressIfPermanent(to: string, error: unknown): Promise<void> {
    const smtp = (error ?? {}) as SmtpError;
    const response = typeof smtp.response === "string" ? smtp.response : "";
    const isPermanentRecipientFailure =
      smtp.command === "RCPT TO" &&
      typeof smtp.responseCode === "number" &&
      smtp.responseCode >= 500 &&
      smtp.responseCode < 600 &&
      PERMANENT_RECIPIENT_STATUS.test(response);
    if (!isPermanentRecipientFailure) return;

    try {
      await this.suppressions.suppress(
        to,
        EmailSuppressionReason.HARD_BOUNCE,
        response,
        "system",
      );
    } catch (suppressError) {
      // The send already failed and was logged; losing the suppression only
      // means the next send to this address fails the same way.
      this.logger.error(
        `email.suppression.record_failed to=${to}`,
        suppressError instanceof Error
          ? suppressError.stack
          : String(suppressError),
      );
    }
  }

  async sendVerificationCode(email: string, code: string): Promise<boolean> {
    return this.send({
      to: email,
      subject: "Mark admin verification code",
      title: "Admin verification code",
      html: `<h1 style="font-size: 20px;">Admin verification code</h1>
       <p>Use this code to finish signing in. It expires in 10 minutes.</p>
       <p style="font-size: 32px; font-weight: bold; letter-spacing: 6px; margin: 24px 0;">${this.escapeHtml(code)}</p>
       <p>If you didn't request this, you can ignore this email. Don't share this code please.</p>`,
      text: `Admin verification code: ${code}

This code expires in 10 minutes. If you didn't request it, ignore this email.`,
    });
  }

  /**
   * Sends a plain-text message. The body is escaped and shown preformatted,
   * so it may safely contain user-written text.
   */
  async sendGenericEmail(
    to: string,
    subject: string,
    body: string,
  ): Promise<boolean> {
    return this.send({
      to,
      subject,
      title: subject,
      html: `<pre style="font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; white-space: pre-wrap; margin: 0;">${this.escapeHtml(body)}</pre>`,
      text: body,
    });
  }

  async sendGradingCompletionEmail(
    email: string,
    assignmentId: number,
    attemptId: number,
    grade?: number,
  ): Promise<boolean> {
    const resultsUrl = this.learnerResultsUrl(assignmentId, attemptId);
    const scoreHtml =
      grade === undefined
        ? ""
        : `<p style="font-size: 32px; font-weight: bold; margin: 16px 0;">${Math.round(grade)}%</p>`;
    const scoreText =
      grade === undefined ? "" : `Score: ${Math.round(grade)}%\n\n`;
    return this.send({
      to: email,
      subject: "Your assignment has been graded",
      title: "Grading complete",
      html: `<h1 style="font-size: 20px;">Your assignment has been graded</h1>
       <p>Your results are ready to view.</p>
       ${scoreHtml}
       <p><a href="${this.escapeHtml(resultsUrl)}">View your results</a></p>
       <p style="color: #64748b; font-size: 14px;">You received this email because you asked to be notified when this submission was graded.</p>`,
      text: `Your assignment has been graded.

${scoreText}View your results: ${resultsUrl}

You received this email because you asked to be notified when this submission was graded.`,
    });
  }

  async sendBugRenewalEmail(
    email: string,
    issueTitle: string,
    issueBody: string,
    renewLink: string,
    closeLink: string,
    reportedAt?: string,
    issueNumber?: number,
  ): Promise<boolean> {
    return this.send({
      to: email,
      subject: "Are you still experiencing this issue?",
      title: "Issue follow-up",
      html: this.bugRenewalHtml(
        issueTitle,
        issueBody,
        renewLink,
        closeLink,
        reportedAt,
        issueNumber,
      ),
      text: this.bugRenewalText(
        issueTitle,
        issueBody,
        renewLink,
        closeLink,
        reportedAt,
        issueNumber,
      ),
    });
  }

  async testConnection(): Promise<boolean> {
    if (!this.transporter) {
      if (process.env.NODE_ENV === "production") {
        this.logger.error("Email service not configured");
        return false;
      }
      this.logger.log("Email service ready (development console logging)");
      return true;
    }

    try {
      await this.transporter.verify();
      return true;
    } catch (error) {
      this.logger.error(
        "SMTP connection failed",
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }

  async sendTestEmail(to: string): Promise<boolean> {
    if (!this.transporter) {
      this.logger.warn("Cannot send test email; email service not configured");
      return false;
    }
    return this.send({
      to,
      subject: "Mark email configuration test",
      title: "Email configuration test",
      html: `<h1 style="font-size: 20px;">Email configuration test</h1>
         <p>If you received this, sending email is working.</p>`,
      text: "If you received this, sending email is working.",
    });
  }

  /** Absolute link to a learner's results page for an attempt. */
  learnerResultsUrl(assignmentId: number, attemptId: number): string {
    return `${this.webAppUrl()}/learner/${assignmentId}/successPage/${attemptId}`;
  }

  private bugRenewalHtml(
    issueTitle: string,
    issueBody: string,
    renewLink: string,
    closeLink: string,
    reportedAt?: string,
    issueNumber?: number,
  ): string {
    // issueTitle/issueBody originate from user-submitted bug reports — escape
    // them before interpolating into the HTML body so report content can't
    // inject markup or rewrite the renew/close links in the recipient's client.
    const safeTitle = this.escapeHtml(issueTitle);
    const safeBody = this.escapeHtml(issueBody);
    const reference = issueNumber ? `Issue #${issueNumber}` : safeTitle;
    const heading =
      reference === safeTitle
        ? ""
        : `<p style="margin: 8px 0 0; font-weight: 600;">${safeTitle}</p>`;
    return `<h1 style="font-size: 20px;">Are you still experiencing this issue?</h1>
       <p>The bug you reported hasn't been resolved yet. Let us know if it's still happening.</p>
       <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
         <p style="margin: 0; font-weight: 600;">${reference}</p>
         <p style="margin: 4px 0 0; color: #64748b; font-size: 14px;">Reported ${this.escapeHtml(this.formatReportedAt(reportedAt))}</p>
         ${heading}
         <p style="margin: 12px 0 0; white-space: pre-wrap;">${safeBody}</p>
       </div>
       <p>
         <a href="${this.escapeHtml(renewLink)}" style="display: inline-block; padding: 12px 20px; margin: 0 8px 0 0; border-radius: 8px; background: #2563eb; color: #ffffff; text-decoration: none; font-weight: 600;">Yes, still happening</a>
         <a href="${this.escapeHtml(closeLink)}" style="display: inline-block; padding: 12px 20px; border-radius: 8px; background: #e2e8f0; color: #0f172a; text-decoration: none; font-weight: 600;">No, resolved</a>
       </p>
       <p>If we don't hear back within 7 days, we'll close the issue.</p>`;
  }

  private bugRenewalText(
    issueTitle: string,
    issueBody: string,
    renewLink: string,
    closeLink: string,
    reportedAt?: string,
    issueNumber?: number,
  ): string {
    const reference = issueNumber ? `Issue #${issueNumber}` : issueTitle;
    const title = reference === issueTitle ? "" : `${issueTitle}\n`;
    return `Are you still experiencing this issue?

The bug you reported hasn't been resolved yet. Let us know if it's still happening.

${reference}
${title}Reported: ${this.formatReportedAt(reportedAt)}

${issueBody}

Yes, still happening: ${renewLink}
No, resolved: ${closeLink}

If we don't hear back within 7 days, we'll close the issue.`;
  }

  // Mail is sent from a no-reply address, so every email says where to get
  // help instead.
  private textFooter(): string {
    return `Need help? Visit ${this.helpUrl}
This email was sent from an address that does not accept replies.`;
  }

  private layout(title: string, content: string): string {
    const helpUrl = this.escapeHtml(this.helpUrl);
    return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${this.escapeHtml(title)}</title>
  </head>
  <body style="margin: 0; padding: 24px; background: #f5f5f5; font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1e293b;">
    <div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 32px; line-height: 1.6;">
      ${content}
      <p style="color: #64748b; font-size: 13px; margin-top: 32px; border-top: 1px solid #e2e8f0; padding-top: 16px;">
        Need help? Visit <a href="${helpUrl}">${helpUrl}</a>.<br />
        This email was sent from an address that does not accept replies.
      </p>
      <p style="color: #94a3b8; font-size: 12px; margin: 8px 0 0;">© ${new Date().getFullYear()} Mark</p>
    </div>
  </body>
</html>`;
  }

  // Escape the HTML-significant characters so user-derived text can be safely
  // interpolated into an email's HTML body.
  private escapeHtml(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  private webAppUrl(): string {
    if (process.env.NODE_ENV === "production") {
      const url = process.env.WEB_APP_URL ?? "";
      if (!url) {
        this.logger.warn(
          "WEB_APP_URL is not set; email links will be relative and may not resolve.",
        );
      }
      return url;
    }
    if (process.env.NODE_ENV === "staging") {
      const url = process.env.STAGING_WEB_APP_URL ?? "";
      if (!url) {
        this.logger.warn(
          "STAGING_WEB_APP_URL is not set; email links will be relative and may not resolve.",
        );
      }
      return url;
    }
    return "http://localhost:3010";
  }

  private formatReportedAt(reportedAt?: string): string {
    if (!reportedAt) return "N/A";
    const parsed = new Date(reportedAt);
    if (Number.isNaN(parsed.getTime())) return reportedAt;
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "numeric",
      minute: "2-digit",
    }).format(parsed);
  }
}
