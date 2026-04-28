/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable unicorn/prefer-module */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, Logger } from "@nestjs/common";
import * as nodemailer from "nodemailer";

/**
 * AdminEmailService supports both SendGrid and Gmail SMTP for sending emails.
 *
 * Environment Variables:
 *
 * EMAIL_PROVIDER - Choose email provider ('sendgrid' | 'google'). Defaults to 'sendgrid'
 *
 * SendGrid Configuration:
 * - SENDGRID_API_KEY: SendGrid API key (required for SendGrid)
 * - SENDGRID_FROM_EMAIL: From email address (defaults to 'noreply@markapp.com')
 * - SENDGRID_FROM_NAME: From name (defaults to 'Mark Admin System')
 *
 * Gmail Configuration:
 * - GMAIL_USER: Gmail email address (required for Gmail)
 * - GMAIL_APP_PASSWORD: Gmail app password (required for Gmail)
 *
 * Fallback Strategy:
 * - If preferred provider is not available, falls back to the other provider
 * - If no providers are configured, uses console logging in development
 * - Fails gracefully in production when no providers are available
 */

type EmailProvider = "sendgrid" | "google" | "none";
const sgMail = require("@sendgrid/mail");
sgMail.setApiKey(process.env.SENDGRID_API_KEY);
@Injectable()
export class AdminEmailService {
  private readonly logger = new Logger(AdminEmailService.name);
  private transporter: nodemailer.Transporter;
  private emailProvider: EmailProvider;

  constructor() {
    this.initializeEmailService();
  }

  private initializeEmailService() {
    const providerPreference =
      process.env.EMAIL_PROVIDER?.toLowerCase() || "sendgrid";

    const sendGridApiKey = process.env.SENDGRID_API_KEY;

    const gmailUser = process.env.GMAIL_USER;
    const gmailPassword = process.env.GMAIL_APP_PASSWORD;

    if (providerPreference === "sendgrid" && sendGridApiKey) {
      try {
        sgMail.setApiKey(sendGridApiKey);
        this.emailProvider = "sendgrid";
        this.transporter = undefined;
        this.logger.log("SendGrid email service initialized");
        return;
      } catch (error) {
        this.logger.error("Failed to initialize SendGrid:", error);
      }
    }

    if (providerPreference === "google" && gmailUser && gmailPassword) {
      this.emailProvider = "google";
      this.transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 587,
        secure: false,
        auth: {
          user: gmailUser,
          pass: gmailPassword,
        },
        requireTLS: true,
      });
      this.logger.log("Gmail SMTP transporter initialized");
      return;
    } else if (gmailUser && gmailPassword) {
      this.emailProvider = "google";
      this.transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 587,
        secure: false,
        auth: {
          user: gmailUser,
          pass: gmailPassword,
        },
        requireTLS: true,
      });
      this.logger.log("Gmail SMTP transporter initialized (fallback)");
      return;
    } else if (
      sendGridApiKey &&
      sgMail &&
      typeof sgMail.setApiKey === "function"
    ) {
      try {
        sgMail.setApiKey(sendGridApiKey);
        this.emailProvider = "sendgrid";
        this.transporter = undefined;
        this.logger.log("SendGrid email service initialized (fallback)");
      } catch (error) {
        this.logger.error("Failed to initialize SendGrid as fallback:", error);
        this.emailProvider = "none";
        this.transporter = undefined;
      }
    } else {
      this.emailProvider = "none";
      this.transporter = undefined;
      this.logger.warn(
        "No email service configured. Set SENDGRID_API_KEY or GMAIL_USER/GMAIL_APP_PASSWORD. Email service will use console logging in development.",
      );
    }
  }

  /**
   * Send verification code email to admin using configured email provider (SendGrid or Gmail)
   */
  async sendVerificationCode(email: string, code: string): Promise<boolean> {
    try {
      if (this.emailProvider === "none") {
        if (process.env.NODE_ENV === "production") {
          this.logger.error("Email service not configured for production");
          return false;
        } else {
          this.logger.log(`
=== ADMIN VERIFICATION CODE ===
Email: ${email}
Code: ${code}
Expires: 10 minutes
Provider: Development Console
===============================`);
          return true;
        }
      }

      if (this.emailProvider === "sendgrid") {
        return await this.sendVerificationCodeSendGrid(email, code);
      } else if (this.emailProvider === "google") {
        return await this.sendVerificationCodeGmail(email, code);
      }

      return false;
    } catch (error) {
      this.logger.error(`Failed to send verification code to ${email}:`, error);
      return false;
    }
  }

  /**
   * Send a generic email (used for report notifications, status updates, etc.)
   */
  async sendGenericEmail(
    to: string,
    subject: string,
    body: string,
  ): Promise<boolean> {
    try {
      if (this.emailProvider === "none") {
        if (process.env.NODE_ENV !== "production") {
          this.logger.log(
            `DEV EMAIL (no provider configured)\nTo: ${to}\nSubject: ${subject}\n\n${body}`,
          );
          return true;
        }
        this.logger.error("Email service not configured for production");
        return false;
      }

      if (this.emailProvider === "sendgrid") {
        const fromEmail =
          process.env.SENDGRID_FROM_EMAIL || "noreply@markapp.com";
        const fromName = process.env.SENDGRID_FROM_NAME || "Mark Support";
        await sgMail.send({
          from: { email: fromEmail, name: fromName },
          to,
          subject,
          text: body,
          html: `<pre style="font-family:Arial, sans-serif; white-space:pre-wrap;">${body}</pre>`,
        });
        return true;
      }

      if (this.emailProvider === "google" && this.transporter) {
        await this.transporter.sendMail({
          from: process.env.GMAIL_USER,
          to,
          subject,
          text: body,
        });
        return true;
      }

      this.logger.error("Email provider not initialized");
      return false;
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}:`, error);
      return false;
    }
  }

  /**
   * Send verification code using SendGrid
   */
  private async sendVerificationCodeSendGrid(
    email: string,
    code: string,
  ): Promise<boolean> {
    try {
      if (!sgMail || typeof sgMail.send !== "function") {
        this.logger.error("SendGrid not properly initialized");
        return false;
      }

      const fromEmail =
        process.env.SENDGRID_FROM_EMAIL || "noreply@markapp.com";
      const fromName = process.env.SENDGRID_FROM_NAME || "Mark Admin System";

      const mailData = {
        from: {
          email: fromEmail,
          name: fromName,
        },
        to: email,
        subject: "Mark Admin Access - Verification Code",
        html: this.getEmailTemplate(code),
        text: this.getPlainTextTemplate(code),
      };

      await sgMail.send(mailData);

      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send verification code via SendGrid to ${email}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Send verification code using Gmail SMTP
   */
  private async sendVerificationCodeGmail(
    email: string,
    code: string,
  ): Promise<boolean> {
    try {
      if (!this.transporter) {
        this.logger.error("Gmail transporter not initialized");
        return false;
      }

      const mailOptions = {
        from: {
          name: "Mark Admin System",
          address: process.env.GMAIL_USER || "noreply@markapp.com",
        },
        to: email,
        subject: "Mark Admin Access - Verification Code",
        html: this.getEmailTemplate(code),
        text: this.getPlainTextTemplate(code),
      };

      await this.transporter.sendMail(mailOptions);
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send verification code via Gmail to ${email}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Get HTML email template
   */
  private getEmailTemplate(code: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Admin Verification Code</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f5f5f5; }
          .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
          .header { background-color: #2563eb; padding: 40px 20px; text-align: center; }
          .header h1 { color: #ffffff; margin: 0; font-size: 28px; font-weight: 600; }
          .content { padding: 40px 20px; }
          .code-container { background-color: #f8fafc; border: 2px solid #e2e8f0; border-radius: 12px; padding: 30px; text-align: center; margin: 30px 0; }
          .code { font-size: 36px; font-weight: bold; color: #1e293b; letter-spacing: 8px; font-family: 'Courier New', monospace; }
          .description { color: #64748b; font-size: 16px; line-height: 1.6; margin: 20px 0; }
          .warning { background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; }
          .warning-text { color: #92400e; font-size: 14px; margin: 0; }
          .footer { background-color: #f8fafc; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0; }
          .footer-text { color: #9ca3af; font-size: 12px; margin: 5px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🛡️ Admin Access</h1>
          </div>
          <div class="content">
            <p class="description">
              Someone requested admin access to the Mark application with your email address.
              Use the verification code below to complete your login:
            </p>
            
            <div class="code-container">
              <div class="code">${code}</div>
            </div>
            
            <div class="warning">
              <p class="warning-text">
                <strong>⚠️ Security Notice:</strong> This code expires in 10 minutes. 
                If you did not request admin access, please ignore this email and consider changing your password.
              </p>
            </div>
            
            <p class="description">
              For security reasons, do not share this code with anyone. Mark administrators will never ask for this code.
            </p>
          </div>
          <div class="footer">
            <p class="footer-text">This is an automated message from Mark Admin System</p>
            <p class="footer-text">© ${new Date().getFullYear()} Mark Application</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Get plain text email template
   */
  private getPlainTextTemplate(code: string): string {
    return `
Mark Admin Access - Verification Code

Someone requested admin access to the Mark application with your email address.

Your verification code is: ${code}

This code will expire in 10 minutes. If you did not request this, please ignore this email.

For security reasons, do not share this code with anyone.

This is an automated message from Mark Admin System.
    `;
  }

  /**
   * Test email service connection
   */
  async testConnection(): Promise<boolean> {
    try {
      if (this.emailProvider === "none") {
        if (process.env.NODE_ENV === "production") {
          this.logger.error("Email service not configured");
          return false;
        } else {
          this.logger.log(
            "Email service ready (development mode - console logging)",
          );
          return true;
        }
      }

      if (this.emailProvider === "sendgrid") {
        this.logger.log("SendGrid email service ready");
        return true;
      }

      if (this.emailProvider === "google" && this.transporter) {
        await this.transporter.verify();
        this.logger.log("Gmail SMTP connection verified successfully");
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error(
        `${this.emailProvider} email service connection failed:`,
        error,
      );
      return false;
    }
  }

  /**
   * Send a test email to verify configuration
   */
  async sendTestEmail(toEmail: string): Promise<boolean> {
    try {
      if (this.emailProvider === "none") {
        this.logger.warn(
          "Cannot send test email - email service not configured",
        );
        return false;
      }

      if (this.emailProvider === "sendgrid") {
        return await this.sendTestEmailSendGrid(toEmail);
      } else if (this.emailProvider === "google") {
        return await this.sendTestEmailGmail(toEmail);
      }

      return false;
    } catch (error) {
      this.logger.error(`Failed to send test email to ${toEmail}:`, error);
      return false;
    }
  }

  /**
   * Send test email using SendGrid
   */
  private async sendTestEmailSendGrid(toEmail: string): Promise<boolean> {
    try {
      if (!sgMail || typeof sgMail.send !== "function") {
        this.logger.error("SendGrid not properly initialized");
        return false;
      }

      const fromEmail =
        process.env.SENDGRID_FROM_EMAIL || "noreply@markapp.com";
      const fromName = process.env.SENDGRID_FROM_NAME || "Mark Admin System";

      const mailData = {
        from: {
          email: fromEmail,
          name: fromName,
        },
        to: toEmail,
        subject: "Mark Admin - Email Configuration Test",
        html: `
          <h2>🎉 Email Configuration Test</h2>
          <p>If you received this email, your SendGrid email configuration is working correctly!</p>
          <p><strong>Provider:</strong> SendGrid</p>
          <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
          <p><em>This is a test message from Mark Admin System.</em></p>
        `,
        text: `
Email Configuration Test

If you received this email, your SendGrid email configuration is working correctly!

Provider: SendGrid
Timestamp: ${new Date().toISOString()}

This is a test message from Mark Admin System.
        `,
      };
      await sgMail.send(mailData);
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send test email via SendGrid to ${toEmail}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Send test email using Gmail SMTP
   */
  private async sendTestEmailGmail(toEmail: string): Promise<boolean> {
    try {
      if (!this.transporter) {
        this.logger.error("Gmail transporter not initialized");
        return false;
      }

      const mailOptions = {
        from: {
          name: "Mark Admin System",
          address: process.env.GMAIL_USER || "noreply@markapp.com",
        },
        to: toEmail,
        subject: "Mark Admin - Email Configuration Test",
        html: `
          <h2>🎉 Email Configuration Test</h2>
          <p>If you received this email, your Gmail SMTP configuration is working correctly!</p>
          <p><strong>Provider:</strong> Gmail SMTP</p>
          <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
          <p><em>This is a test message from Mark Admin System.</em></p>
        `,
        text: `
Email Configuration Test

If you received this email, your Gmail SMTP configuration is working correctly!

Provider: Gmail SMTP
Timestamp: ${new Date().toISOString()}

This is a test message from Mark Admin System.
        `,
      };

      await this.transporter.sendMail(mailOptions);

      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send test email via Gmail to ${toEmail}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Send grading completion notification email
   */
  async sendGradingCompletionEmail(
    email: string,
    assignmentId: number,
    attemptId: number,
    grade?: number,
  ): Promise<boolean> {
    try {
      if (this.emailProvider === "none") {
        if (process.env.NODE_ENV === "production") {
          this.logger.error("Email service not configured for production");
          return false;
        } else {
          this.logger.log(`
=== GRADING COMPLETION NOTIFICATION ===
Email: ${email}
Assignment ID: ${assignmentId}
Attempt ID: ${attemptId}
Grade: ${grade === undefined ? "N/A" : `${Math.round(grade)}%`}
Provider: Development Console
========================================`);
          return true;
        }
      }

      if (this.emailProvider === "sendgrid") {
        return await this.sendGradingCompletionSendGrid(
          email,
          assignmentId,
          attemptId,
          grade,
        );
      } else if (this.emailProvider === "google") {
        return await this.sendGradingCompletionGmail(
          email,
          assignmentId,
          attemptId,
          grade,
        );
      }

      return false;
    } catch (error) {
      this.logger.error(
        `Failed to send grading completion email to ${email}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Send grading completion email using SendGrid
   */
  private async sendGradingCompletionSendGrid(
    email: string,
    assignmentId: number,
    attemptId: number,
    grade?: number,
  ): Promise<boolean> {
    try {
      if (!sgMail || typeof sgMail.send !== "function") {
        this.logger.error("SendGrid not properly initialized");
        return false;
      }

      const fromEmail =
        process.env.SENDGRID_FROM_EMAIL || "noreply@markapp.com";
      const fromName = process.env.SENDGRID_FROM_NAME || "Mark Grading System";

      const baseUrl =
        process.env.NODE_ENV === "production"
          ? process.env.WEB_APP_URL
          : process.env.NODE_ENV === "staging"
            ? process.env.STAGING_WEB_APP_URL
            : "http://localhost:3010";

      const resultsUrl = `${baseUrl}/learner/${assignmentId}/successPage/${attemptId}`;

      const mailData = {
        from: {
          email: fromEmail,
          name: fromName,
        },
        to: email,
        subject: "Your Assignment Has Been Graded! ",
        html: this.getGradingCompletionTemplate(resultsUrl, grade),
        text: this.getGradingCompletionPlainText(resultsUrl, grade),
      };

      await sgMail.send(mailData);
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send grading completion via SendGrid to ${email}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Send grading completion email using Gmail SMTP
   */
  private async sendGradingCompletionGmail(
    email: string,
    assignmentId: number,
    attemptId: number,
    grade?: number,
  ): Promise<boolean> {
    try {
      if (!this.transporter) {
        this.logger.error("Gmail transporter not initialized");
        return false;
      }

      const baseUrl = process.env.WEB_APP_URL || "http://localhost:3010";
      const resultsUrl = `${baseUrl}/learner/${assignmentId}/successPage/${attemptId}`;

      const mailOptions = {
        from: {
          name: "Mark Grading System",
          address: process.env.GMAIL_USER || "noreply@markapp.com",
        },
        to: email,
        subject: "Your Assignment Has Been Graded! ✅",
        html: this.getGradingCompletionTemplate(resultsUrl, grade),
        text: this.getGradingCompletionPlainText(resultsUrl, grade),
      };

      await this.transporter.sendMail(mailOptions);
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send grading completion via Gmail to ${email}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Get HTML template for grading completion email
   */
  private getGradingCompletionTemplate(
    resultsUrl: string,
    grade?: number,
  ): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Grading Complete</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f5f5f5; }
          .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
          .header { background-color: #8b5cf6; padding: 40px 20px; text-align: center; }
          .header h1 { color: #ffffff; margin: 0; font-size: 28px; font-weight: 600; }
          .content { padding: 40px 20px; }
          .grade-container { background: linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%); border-radius: 12px; padding: 30px; text-align: center; margin: 30px 0; }
          .grade { font-size: 48px; font-weight: bold; color: #ffffff; margin: 10px 0; }
          .grade-label { color: #e9d5ff; font-size: 14px; text-transform: uppercase; letter-spacing: 2px; }
          .description { color: #64748b; font-size: 16px; line-height: 1.6; margin: 20px 0; }
          .cta-button { display: inline-block; background-color: #8b5cf6; color: #ffffff; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 600; margin: 20px 0; transition: background-color 0.3s; }
          .cta-button:hover { background-color: #7c3aed; }
          .features { background-color: #f8fafc; border-radius: 12px; padding: 20px; margin: 20px 0; }
          .feature { display: flex; align-items: start; margin: 15px 0; }
          .feature-icon { flex-shrink: 0; width: 24px; height: 24px; margin-right: 12px; }
          .feature-text { color: #475569; font-size: 14px; line-height: 1.5; }
          .footer { background-color: #f8fafc; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0; }
          .footer-text { color: #9ca3af; font-size: 12px; margin: 5px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1> Grading Complete!</h1>
          </div>
          <div class="content">
            <p class="description">
              Great news! Your assignment has been graded and your results are ready to view.
            </p>

            ${
              grade === undefined
                ? `
            <div class="grade-container">
              <div class="grade">📊</div>
              <div class="grade-label">Results Ready</div>
            </div>
            `
                : `
            <div class="grade-container">
              <div class="grade-label">Your Score</div>
              <div class="grade">${Math.round(grade)}%</div>
            </div>
            `
            }

            <div style="text-align: center;">
              <a href="${resultsUrl}" class="cta-button">View Your Results</a>
            </div>

            <div class="features">
              <div class="feature">
                <svg class="feature-icon" fill="none" stroke="#8b5cf6" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <div class="feature-text">
                  <strong>Detailed Feedback:</strong> Review AI-generated feedback for each question
                </div>
              </div>
              <div class="feature">
                <svg class="feature-icon" fill="none" stroke="#8b5cf6" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <div class="feature-text">
                  <strong>Score Breakdown:</strong> See how you performed on each criterion
                </div>
              </div>
              <div class="feature">
                <svg class="feature-icon" fill="none" stroke="#8b5cf6" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path>
                </svg>
                <div class="feature-text">
                  <strong>Improvement Tips:</strong> Get guidance on how to improve for next time
                </div>
              </div>
            </div>

            <p class="description">
              Click the button above to access your complete grading report and feedback.
            </p>
          </div>
          <div class="footer">
            <p class="footer-text">This is an automated notification from Mark Grading System</p>
            <p class="footer-text">© ${new Date().getFullYear()} Mark Application</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Get plain text template for grading completion email
   */
  private getGradingCompletionPlainText(
    resultsUrl: string,
    grade?: number,
  ): string {
    return `
Grading Complete!

Great news! Your assignment has been graded and your results are ready to view.

${grade === undefined ? "" : `Your Score: ${Math.round(grade)}%\n`}
View Your Results: ${resultsUrl}

What's Included:
• Detailed Feedback: Review AI-generated feedback for each question
• Score Breakdown: See how you performed on each criterion
• Improvement Tips: Get guidance on how to improve for next time

Click the link above to access your complete grading report and feedback.

This is an automated notification from Mark Grading System.
© ${new Date().getFullYear()} Mark Application
    `;
  }

  /**
   * Send bug renewal email asking if the user is still experiencing the issue
   */
  async sendBugRenewalEmail(
    email: string,
    issueTitle: string,
    issueBody: string,
    renewLink: string,
    closeLink: string,
    reportedAt?: string,
    issueNumber?: number,
  ): Promise<boolean> {
    try {
      if (this.emailProvider === "none") {
        if (process.env.NODE_ENV === "production") {
          this.logger.error("Email service not configured for production");
          return false;
        } else {
          this.logger.log(`
=== BUG RENEWAL EMAIL ===
Email: ${email}
Issue: ${issueNumber ?? "N/A"} - ${issueTitle}
Reported At: ${reportedAt ?? "N/A"}
Renew Link: ${renewLink}
Close Link: ${closeLink}
Provider: Development Console
=========================`);
          return true;
        }
      }

      if (this.emailProvider === "sendgrid") {
        return await this.sendBugRenewalEmailSendGrid(
          email,
          issueTitle,
          issueBody,
          renewLink,
          closeLink,
          reportedAt,
          issueNumber,
        );
      } else if (this.emailProvider === "google") {
        return await this.sendBugRenewalEmailGmail(
          email,
          issueTitle,
          issueBody,
          renewLink,
          closeLink,
          reportedAt,
          issueNumber,
        );
      }

      return false;
    } catch (error) {
      this.logger.error(`Failed to send bug renewal email to ${email}:`, error);
      return false;
    }
  }

  /**
   * Send bug renewal email using SendGrid
   */
  private async sendBugRenewalEmailSendGrid(
    email: string,
    issueTitle: string,
    issueBody: string,
    renewLink: string,
    closeLink: string,
    reportedAt?: string,
    issueNumber?: number,
  ): Promise<boolean> {
    try {
      if (!sgMail || typeof sgMail.send !== "function") {
        this.logger.error("SendGrid not properly initialized");
        return false;
      }

      const fromEmail =
        process.env.SENDGRID_FROM_EMAIL || "noreply@markapp.com";
      const fromName = process.env.SENDGRID_FROM_NAME || "Mark Support";

      const mailData = {
        from: {
          email: fromEmail,
          name: fromName,
        },
        to: email,
        subject: "Are you still experiencing this issue?",
        html: this.getBugRenewalTemplate(
          issueTitle,
          issueBody,
          renewLink,
          closeLink,
          reportedAt,
          issueNumber,
        ),
        text: this.getBugRenewalPlainText(
          issueTitle,
          issueBody,
          renewLink,
          closeLink,
          reportedAt,
          issueNumber,
        ),
      };

      await sgMail.send(mailData);
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send bug renewal email via SendGrid to ${email}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Send bug renewal email using Gmail SMTP
   */
  private async sendBugRenewalEmailGmail(
    email: string,
    issueTitle: string,
    issueBody: string,
    renewLink: string,
    closeLink: string,
    reportedAt?: string,
    issueNumber?: number,
  ): Promise<boolean> {
    try {
      if (!this.transporter) {
        this.logger.error("Gmail transporter not initialized");
        return false;
      }

      const mailOptions = {
        from: {
          name: "Mark Support",
          address: process.env.GMAIL_USER || "noreply@markapp.com",
        },
        to: email,
        subject: "Are you still experiencing this issue?",
        html: this.getBugRenewalTemplate(
          issueTitle,
          issueBody,
          renewLink,
          closeLink,
          reportedAt,
          issueNumber,
        ),
        text: this.getBugRenewalPlainText(
          issueTitle,
          issueBody,
          renewLink,
          closeLink,
          reportedAt,
          issueNumber,
        ),
      };

      await this.transporter.sendMail(mailOptions);
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send bug renewal email via Gmail to ${email}:`,
        error,
      );
      return false;
    }
  }

  private getBugRenewalTemplate(
    issueTitle: string,
    issueBody: string,
    renewLink: string,
    closeLink: string,
    reportedAt?: string,
    issueNumber?: number,
  ): string {
    const issueReference = issueNumber ? `Issue #${issueNumber}` : issueTitle;
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Issue Follow-up</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f5f5f5; }
          .container { max-width: 640px; margin: 0 auto; background-color: #ffffff; }
          .header { background-color: #0f172a; padding: 32px 20px; text-align: center; }
          .header h1 { color: #ffffff; margin: 0; font-size: 24px; font-weight: 600; }
          .content { padding: 32px 20px; }
          .summary { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 20px 0; }
          .summary-title { font-weight: 600; color: #0f172a; margin: 0 0 8px; }
          .meta { color: #64748b; font-size: 14px; margin: 0 0 12px; }
          .body { color: #1e293b; font-size: 14px; line-height: 1.6; white-space: pre-wrap; }
          .button-row { text-align: center; margin: 24px 0; }
          .btn { display: inline-block; padding: 12px 20px; border-radius: 8px; font-weight: 600; text-decoration: none; margin: 6px; }
          .btn-renew { background-color: #2563eb; color: #ffffff; }
          .btn-close { background-color: #e2e8f0; color: #0f172a; }
          .footer { background-color: #f8fafc; padding: 16px; text-align: center; border-top: 1px solid #e2e8f0; }
          .footer-text { color: #94a3b8; font-size: 12px; margin: 4px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Are you still experiencing this issue?</h1>
          </div>
          <div class="content">
            <p>We noticed the bug you reported hasn't been resolved yet. Let us know if you're still experiencing it.</p>
            <div class="summary">
              <p class="summary-title">${issueReference}</p>
              <p class="meta">Reported ${this.formatReportedAt(reportedAt)}</p>
              ${issueReference === issueTitle ? "" : `<p class="summary-title">${issueTitle}</p>`}
              <p class="summary-title">Description</p>
              <div class="body">${issueBody}</div>
            </div>
            <div class="button-row">
              <a class="btn btn-renew" href="${renewLink}">Yes, still happening</a>
              <a class="btn btn-close" href="${closeLink}">No, resolved</a>
            </div>
            <p>If we don't hear back within 7 days, we'll close the issue.</p>
            <p>If you didn't request this, you can ignore this email.</p>
          </div>
          <div class="footer">
            <p class="footer-text">This is an automated message from Mark Support</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private getBugRenewalPlainText(
    issueTitle: string,
    issueBody: string,
    renewLink: string,
    closeLink: string,
    reportedAt?: string,
    issueNumber?: number,
  ): string {
    const issueReference = issueNumber ? `Issue #${issueNumber}` : issueTitle;
    return `
Are you still experiencing this issue?

We noticed the bug you reported hasn't been resolved yet. Let us know if you're still experiencing it.

${issueReference}
${issueReference === issueTitle ? "" : issueTitle}
Reported: ${this.formatReportedAt(reportedAt)}

Description:
${issueBody}

Yes, still happening: ${renewLink}
No, resolved: ${closeLink}

If we don't hear back within 7 days, we'll close the issue.

If you didn't request this, you can ignore this email.
    `;
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
