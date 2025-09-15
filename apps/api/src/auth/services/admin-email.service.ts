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

      // Route to appropriate email service
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
}
