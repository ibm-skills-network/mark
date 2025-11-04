/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable unicorn/prefer-module */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, Logger } from "@nestjs/common";
import * as nodemailer from "nodemailer";

/**
 * General EmailService for app-wide email sending
 * Supports both SendGrid and Gmail SMTP
 */

type EmailProvider = "sendgrid" | "google" | "none";
const sgMail = require("@sendgrid/mail");

export interface EmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: {
    email: string;
    name: string;
  };
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;
  private emailProvider: EmailProvider;
  private readonly defaultFromEmail: string;
  private readonly defaultFromName: string;

  constructor() {
    this.defaultFromEmail =
      process.env.SENDGRID_FROM_EMAIL ||
      process.env.GMAIL_USER ||
      "noreply@markapp.com";
    this.defaultFromName =
      process.env.SENDGRID_FROM_NAME ||
      process.env.APP_NAME ||
      "Mark Application";

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
      this.initializeGmailTransporter(gmailUser, gmailPassword);
      return;
    }

    if (gmailUser && gmailPassword) {
      this.initializeGmailTransporter(gmailUser, gmailPassword);
      return;
    } else if (sendGridApiKey) {
      try {
        sgMail.setApiKey(sendGridApiKey);
        this.emailProvider = "sendgrid";
        this.transporter = undefined;
        this.logger.log("SendGrid email service initialized (fallback)");
        return;
      } catch (error) {
        this.logger.error("Failed to initialize SendGrid as fallback:", error);
      }
    }

    this.emailProvider = "none";
    this.transporter = undefined;
    this.logger.warn(
      "No email service configured. Set SENDGRID_API_KEY or GMAIL_USER/GMAIL_APP_PASSWORD.",
    );
  }

  private initializeGmailTransporter(gmailUser: string, gmailPassword: string) {
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
  }

  /**
   * Send email using configured provider
   */
  async sendEmail(options: EmailOptions): Promise<boolean> {
    try {
      if (this.emailProvider === "none") {
        if (process.env.NODE_ENV === "production") {
          this.logger.error("Email service not configured for production");
          return false;
        } else {
          this.logger.log(`
=== EMAIL (Development Mode) ===
To: ${Array.isArray(options.to) ? options.to.join(", ") : options.to}
Subject: ${options.subject}
Provider: Console
================================`);
          return true;
        }
      }

      if (this.emailProvider === "sendgrid") {
        return await this.sendEmailSendGrid(options);
      } else if (this.emailProvider === "google") {
        return await this.sendEmailGmail(options);
      }

      return false;
    } catch (error) {
      this.logger.error(
        `Failed to send email to ${JSON.stringify(options.to)}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Send email using SendGrid
   */
  private async sendEmailSendGrid(options: EmailOptions): Promise<boolean> {
    try {
      if (!sgMail || typeof sgMail.send !== "function") {
        this.logger.error("SendGrid not properly initialized");
        return false;
      }

      const mailData = {
        from: options.from || {
          email: this.defaultFromEmail,
          name: this.defaultFromName,
        },
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text || this.htmlToText(options.html),
      };

      await sgMail.send(mailData);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send email via SendGrid:`, error);
      return false;
    }
  }

  /**
   * Send email using Gmail SMTP
   */
  private async sendEmailGmail(options: EmailOptions): Promise<boolean> {
    try {
      if (!this.transporter) {
        this.logger.error("Gmail transporter not initialized");
        return false;
      }

      const fromAddress = options.from
        ? { name: options.from.name, address: options.from.email }
        : { name: this.defaultFromName, address: this.defaultFromEmail };

      const mailOptions = {
        from: fromAddress,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text || this.htmlToText(options.html),
      };

      await this.transporter.sendMail(mailOptions);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send email via Gmail:`, error);
      return false;
    }
  }

  /**
   * Simple HTML to text converter
   */
  private htmlToText(html: string): string {
    return html
      .replaceAll(/<[^>]*>/g, "")
      .replaceAll("&nbsp;", " ")
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .trim();
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
          this.logger.log("Email service ready (development mode)");
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
      this.logger.error(`Email service connection failed:`, error);
      return false;
    }
  }

  /**
   * Get default from email
   */
  getDefaultFromEmail(): string {
    return this.defaultFromEmail;
  }

  /**
   * Get default from name
   */
  getDefaultFromName(): string {
    return this.defaultFromName;
  }

  /**
   * Check if email service is configured
   */
  isConfigured(): boolean {
    return this.emailProvider !== "none";
  }

  /**
   * Send regrading request notification to authors
   */
  async sendRegradingRequestNotification(
    authorEmails: string[],
    learnerUserId: string,
    assignmentName: string,
    assignmentId: number,
    attemptId: number,
    regradingRequestId: number,
    reason: string,
    currentGrade: number,
    proposedGrade: number | null,
    questionIds: number[],
  ): Promise<boolean> {
    try {
      const questionText =
        questionIds.length > 0
          ? ` (Question${questionIds.length > 1 ? "s" : ""} ${questionIds
              .map((id) => `Q${id}`)
              .join(", ")})`
          : "";
      const proposedGradeText = proposedGrade
        ? `${(proposedGrade * 100).toFixed(1)}%`
        : "N/A";

      const emailOptions: EmailOptions = {
        to: authorEmails,
        subject: `Regrading Request for "${assignmentName}"${questionText}`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f5f5f5; }
              .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
              .header { background-color: #f59e0b; padding: 30px 20px; text-align: center; }
              .header h1 { color: #ffffff; margin: 0; font-size: 24px; font-weight: 600; }
              .content { padding: 30px 20px; }
              .info-box { background-color: #f8fafc; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0; }
              .info-row { margin: 10px 0; }
              .info-label { font-weight: 600; color: #475569; }
              .info-value { color: #1e293b; }
              .reason-box { background-color: #fef3c7; border: 1px solid #fbbf24; border-radius: 8px; padding: 15px; margin: 20px 0; }
              .reason-title { font-weight: 600; color: #92400e; margin-bottom: 10px; }
              .reason-text { color: #78350f; line-height: 1.6; }
              .button { display: inline-block; background-color: #3b82f6; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; font-weight: 600; }
              .footer { background-color: #f8fafc; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0; }
              .footer-text { color: #9ca3af; font-size: 12px; margin: 5px 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>📝 New Regrading Request ${
                  process.env.NODE_ENV === "production"
                    ? ""
                    : " (This is a test email)"
                }</h1>
              </div>
              <div class="content">
                <p>A learner has submitted a regrading request for your assignment.</p>

                <div class="info-box">
                  <div class="info-row">
                    <span class="info-label">Assignment:</span>
                    <span class="info-value">${assignmentName}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">Learner ID:</span>
                    <span class="info-value">${learnerUserId}</span>
                  </div>
                  ${
                    questionIds.length > 0
                      ? `
                  <div class="info-row">
                    <span class="info-label">Question${
                      questionIds.length > 1 ? "s" : ""
                    }:</span>
                    <span class="info-value">${questionIds
                      .map((id) => `Q${id}`)
                      .join(", ")}</span>
                  </div>
                  `
                      : ""
                  }
                  <div class="info-row">
                    <span class="info-label">Current Grade:</span>
                    <span class="info-value">${(currentGrade * 100).toFixed(
                      1,
                    )}%</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">AI Proposed Grade:</span>
                    <span class="info-value">${proposedGradeText}</span>
                  </div>
                </div>

                <div class="reason-box">
                  <div class="reason-title">Learner's Reason:</div>
                  <div class="reason-text">${reason}</div>
                </div>

                <p style="text-align: center;">
                  <a href="${
                    process.env.FRONTEND_URL || "http://localhost:3000"
                  }/admin-dashboard/regrading-requests" class="button">
                    Review Request
                  </a>
                </p>

                <p style="color: #64748b; font-size: 14px;">
                  You can review this request in the admin dashboard and manually adjust the grade if needed.
                </p>
              </div>
              <div class="footer">
                <p class="footer-text">This is an automated message from Mark Application</p>
                <p class="footer-text">© ${new Date().getFullYear()} Mark Application</p>
              </div>
            </div>
          </body>
          </html>
        `,
        text: `
New Regrading Request

A learner has submitted a regrading request for your assignment.

Assignment: ${assignmentName}
Learner ID: ${learnerUserId}
${
  questionIds.length > 0
    ? `Question${questionIds.length > 1 ? "s" : ""}: ${questionIds
        .map((id) => `Q${id}`)
        .join(", ")}\n`
    : ""
}Current Grade: ${(currentGrade * 100).toFixed(1)}%
AI Proposed Grade: ${proposedGradeText}

Learner's Reason:
${reason}

Review this request in the admin dashboard:
${process.env.FRONTEND_URL || "http://localhost:3000"}/admin-dashboard/regrading-requests

This is an automated message from Mark Application.
        `,
      };

      return await this.sendEmail(emailOptions);
    } catch (error) {
      this.logger.error(
        "Failed to send regrading request notification:",
        error,
      );
      return false;
    }
  }

  /**
   * Send grade update notification to learner
   */
  async sendGradeUpdateNotification(
    learnerEmail: string,
    assignmentName: string,
    assignmentId: number,
    attemptId: number,
    oldGrade: number,
    newGrade: number,
    status: "APPROVED" | "REJECTED" | "COMPLETED",
  ): Promise<boolean> {
    try {
      const isApproved = status === "APPROVED" || status === "COMPLETED";
      const gradeChanged = Math.abs(newGrade - oldGrade) > 0.001;

      let statusText = "";
      let statusColor = "";
      let headerColor = "";

      if (isApproved && gradeChanged) {
        statusText = "Your regrading request has been approved";
        statusColor = "#10b981";
        headerColor = "#10b981";
      } else if (isApproved && !gradeChanged) {
        statusText = "Your regrading request has been reviewed";
        statusColor = "#3b82f6";
        headerColor = "#3b82f6";
      } else {
        statusText = "Your regrading request has been reviewed";
        statusColor = "#ef4444";
        headerColor = "#ef4444";
      }

      const emailOptions: EmailOptions = {
        to: learnerEmail,
        subject:
          process.env.NODE_ENV === "production"
            ? `📊 Grade Update for "${assignmentName}"`
            : `📊 Grade Update (This is a test) for "${assignmentName}"`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f5f5f5; }
              .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
              .header { background-color: ${headerColor}; padding: 30px 20px; text-align: center; }
              .header h1 { color: #ffffff; margin: 0; font-size: 24px; font-weight: 600; }
              .content { padding: 30px 20px; }
              .status-box { background-color: #f8fafc; border-left: 4px solid ${statusColor}; padding: 15px; margin: 20px 0; text-align: center; }
              .status-text { font-size: 18px; font-weight: 600; color: ${statusColor}; margin: 0; }
              .grade-comparison { display: flex; justify-content: center; align-items: center; margin: 30px 0; }
              .grade-box { padding: 20px; text-align: center; }
              .grade-label { font-size: 14px; color: #64748b; margin-bottom: 5px; }
              .grade-value { font-size: 32px; font-weight: bold; color: #1e293b; }
              .arrow { font-size: 24px; color: #64748b; margin: 0 20px; }
              .button { display: inline-block; background-color: #3b82f6; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; font-weight: 600; }
              .footer { background-color: #f8fafc; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0; }
              .footer-text { color: #9ca3af; font-size: 12px; margin: 5px 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>${
                  process.env.NODE_ENV === "production"
                    ? "📊 Grade Update"
                    : "📊 Grade Update (This is a test)"
                }</h1>
              </div>
              <div class="content">
                <div class="status-box">
                  <p class="status-text">${statusText}</p>
                </div>

                <p style="text-align: center; color: #475569; font-size: 16px;">
                  Assignment: <strong>${assignmentName}</strong>
                </p>

                ${
                  gradeChanged
                    ? `
                <div class="grade-comparison">
                  <div class="grade-box">
                    <div class="grade-label">Previous Grade</div>
                    <div class="grade-value">${(oldGrade * 100).toFixed(
                      1,
                    )}%</div>
                  </div>
                  <div class="arrow">→</div>
                  <div class="grade-box">
                    <div class="grade-label">New Grade</div>
                    <div class="grade-value" style="color: ${
                      newGrade > oldGrade ? "#10b981" : "#ef4444"
                    };">${(newGrade * 100).toFixed(1)}%</div>
                  </div>
                </div>
                `
                    : `
                <div style="text-align: center; margin: 30px 0;">
                  <div class="grade-label">Your Grade</div>
                  <div class="grade-value">${(newGrade * 100).toFixed(1)}%</div>
                  <p style="color: #64748b; margin-top: 10px;">Your grade remains unchanged</p>
                </div>
                `
                }
               
              </div>
              <div class="footer">
                <p class="footer-text">This is an automated message from Mark Application</p>
                <p class="footer-text">© ${new Date().getFullYear()} Mark Application</p>
              </div>
            </div>
          </body>
          </html>
        `,
        text: `
Grade Update

${statusText}

Assignment: ${assignmentName}

${
  gradeChanged
    ? `Previous Grade: ${(oldGrade * 100).toFixed(1)}%
New Grade: ${(newGrade * 100).toFixed(1)}%`
    : `Your Grade: ${(newGrade * 100).toFixed(1)}%
Your grade remains unchanged.`
}

View your assignment:
${
  process.env.FRONTEND_URL || "http://localhost:3000"
}/learner/${assignmentId}/successPage/${attemptId}

This is an automated message from Mark Application.
        `,
      };

      return await this.sendEmail(emailOptions);
    } catch (error) {
      this.logger.error("Failed to send grade update notification:", error);
      return false;
    }
  }
}
