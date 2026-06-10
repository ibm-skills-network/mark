import { Injectable, Logger } from "@nestjs/common";
import sgMail from "@sendgrid/mail";
import * as nodemailer from "nodemailer";

/**
 * Sends transactional email through SendGrid or Gmail SMTP.
 *
 * Configured via environment variables:
 *   EMAIL_PROVIDER       "sendgrid" (default) or "google"
 *   SENDGRID_API_KEY     enables SendGrid
 *   SENDGRID_FROM_EMAIL  sender address (default noreply@mark.skills.network)
 *   SENDGRID_FROM_NAME   sender name (default Mark)
 *   GMAIL_USER           Gmail address, enables Gmail SMTP
 *   GMAIL_APP_PASSWORD   Gmail app password
 *
 * If the preferred provider isn't configured it falls back to the other one.
 * With neither configured, emails are logged to the console in development and
 * skipped in production.
 */

type EmailProvider = "sendgrid" | "google" | "none";

interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

// nodemailer ships no type definitions, so type the small surface we use.
interface MailTransport {
  sendMail(message: EmailMessage & { from: string }): Promise<unknown>;
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

const DEFAULT_FROM_EMAIL = "noreply@mark.skills.network";
const DEFAULT_FROM_NAME = "Mark";

@Injectable()
export class AdminEmailService {
  private readonly logger = new Logger(AdminEmailService.name);
  private provider: EmailProvider = "none";
  private transporter?: MailTransport;
  private from = `${DEFAULT_FROM_NAME} <${DEFAULT_FROM_EMAIL}>`;

  constructor() {
    this.configureProvider();
  }

  private configureProvider(): void {
    const preference = process.env.EMAIL_PROVIDER?.toLowerCase() ?? "sendgrid";
    const sendgridKey = process.env.SENDGRID_API_KEY;
    const gmailUser = process.env.GMAIL_USER;
    const gmailPassword = process.env.GMAIL_APP_PASSWORD;

    // Honor the requested provider, otherwise use whichever one is configured.
    if (preference !== "google" && sendgridKey) {
      this.useSendGrid(sendgridKey);
    } else if (gmailUser && gmailPassword) {
      this.useGmail(gmailUser, gmailPassword);
    } else if (sendgridKey) {
      this.useSendGrid(sendgridKey);
    } else {
      this.logger.warn(
        "No email provider configured. Set SENDGRID_API_KEY or GMAIL_USER/GMAIL_APP_PASSWORD. Emails are logged to the console in development.",
      );
    }
  }

  private useSendGrid(key: string): void {
    sgMail.setApiKey(key);
    this.provider = "sendgrid";
    const email = process.env.SENDGRID_FROM_EMAIL || DEFAULT_FROM_EMAIL;
    const name = process.env.SENDGRID_FROM_NAME || DEFAULT_FROM_NAME;
    this.from = `${name} <${email}>`;
    this.logger.log("Email service using SendGrid");
  }

  private useGmail(user: string, pass: string): void {
    this.provider = "google";
    this.transporter = mailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user, pass },
    });
    this.from = `${DEFAULT_FROM_NAME} <${user}>`;
    this.logger.log("Email service using Gmail SMTP");
  }

  private async send(message: EmailMessage): Promise<boolean> {
    if (this.provider === "none") {
      if (process.env.NODE_ENV === "production") {
        this.logger.error("Email service not configured; email not sent");
        return false;
      }
      this.logger.log(
        `Email (no provider configured)\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`,
      );
      return true;
    }

    try {
      if (this.provider === "sendgrid") {
        await sgMail.send({ ...message, from: this.from });
      } else if (this.transporter) {
        await this.transporter.sendMail({ ...message, from: this.from });
      } else {
        this.logger.error("Email provider not initialized; email not sent");
        return false;
      }
      return true;
    } catch (error) {
      this.logger.error(`Failed to send email to ${message.to}`, error);
      return false;
    }
  }

  async sendVerificationCode(email: string, code: string): Promise<boolean> {
    return this.send({
      to: email,
      subject: "Mark admin verification code",
      html: this.verificationHtml(code),
      text: this.verificationText(code),
    });
  }

  async sendGenericEmail(
    to: string,
    subject: string,
    body: string,
  ): Promise<boolean> {
    return this.send({
      to,
      subject,
      text: body,
      html: `<pre style="font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; white-space: pre-wrap;">${body}</pre>`,
    });
  }

  async sendGradingCompletionEmail(
    email: string,
    assignmentId: number,
    attemptId: number,
    grade?: number,
  ): Promise<boolean> {
    const resultsUrl = `${this.webAppUrl()}/learner/${assignmentId}/successPage/${attemptId}`;
    return this.send({
      to: email,
      subject: "Your assignment has been graded",
      html: this.gradingHtml(resultsUrl, grade),
      text: this.gradingText(resultsUrl, grade),
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
    if (this.provider === "none") {
      if (process.env.NODE_ENV === "production") {
        this.logger.error("Email service not configured");
        return false;
      }
      this.logger.log("Email service ready (development console logging)");
      return true;
    }

    if (this.provider === "google" && this.transporter) {
      try {
        await this.transporter.verify();
      } catch (error) {
        this.logger.error("Gmail SMTP connection failed", error);
        return false;
      }
    }

    return true;
  }

  async sendTestEmail(to: string): Promise<boolean> {
    if (this.provider === "none") {
      this.logger.warn("Cannot send test email; email service not configured");
      return false;
    }
    return this.send({
      to,
      subject: "Mark email configuration test",
      html: this.layout(
        "Email configuration test",
        `<h1 style="font-size: 20px;">Email configuration test</h1>
         <p>If you received this, sending email is working.</p>`,
      ),
      text: "If you received this, sending email is working.",
    });
  }

  private verificationHtml(code: string): string {
    return this.layout(
      "Admin verification code",
      `<h1 style="font-size: 20px;">Admin verification code</h1>
       <p>Use this code to finish signing in. It expires in 10 minutes.</p>
       <p style="font-size: 32px; font-weight: bold; letter-spacing: 6px; margin: 24px 0;">${code}</p>
       <p>If you didn't request this, you can ignore this email. Don't share this code please.</p>`,
    );
  }

  private verificationText(code: string): string {
    return `Admin verification code: ${code}

This code expires in 10 minutes. If you didn't request it, ignore this email.`;
  }

  private gradingHtml(resultsUrl: string, grade?: number): string {
    const score =
      grade === undefined
        ? ""
        : `<p style="font-size: 32px; font-weight: bold; margin: 16px 0;">${Math.round(grade)}%</p>`;
    return this.layout(
      "Grading complete",
      `<h1 style="font-size: 20px;">Your assignment has been graded</h1>
       <p>Your results are ready to view.</p>
       ${score}
       <p><a href="${resultsUrl}">View your results</a></p>`,
    );
  }

  private gradingText(resultsUrl: string, grade?: number): string {
    const score = grade === undefined ? "" : `Score: ${Math.round(grade)}%\n\n`;
    return `Your assignment has been graded.

${score}View your results: ${resultsUrl}`;
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
    return this.layout(
      "Issue follow-up",
      `<h1 style="font-size: 20px;">Are you still experiencing this issue?</h1>
       <p>The bug you reported hasn't been resolved yet. Let us know if it's still happening.</p>
       <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
         <p style="margin: 0; font-weight: 600;">${reference}</p>
         <p style="margin: 4px 0 0; color: #64748b; font-size: 14px;">Reported ${this.formatReportedAt(reportedAt)}</p>
         ${heading}
         <p style="margin: 12px 0 0; white-space: pre-wrap;">${safeBody}</p>
       </div>
       <p>
         <a href="${renewLink}" style="display: inline-block; padding: 12px 20px; margin: 0 8px 0 0; border-radius: 8px; background: #2563eb; color: #ffffff; text-decoration: none; font-weight: 600;">Yes, still happening</a>
         <a href="${closeLink}" style="display: inline-block; padding: 12px 20px; border-radius: 8px; background: #e2e8f0; color: #0f172a; text-decoration: none; font-weight: 600;">No, resolved</a>
       </p>
       <p>If we don't hear back within 7 days, we'll close the issue.</p>`,
    );
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

  private layout(title: string, content: string): string {
    return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
  </head>
  <body style="margin: 0; padding: 24px; background: #f5f5f5; font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1e293b;">
    <div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 32px; line-height: 1.6;">
      ${content}
      <p style="color: #94a3b8; font-size: 12px; margin-top: 32px;">© ${new Date().getFullYear()} Mark</p>
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
