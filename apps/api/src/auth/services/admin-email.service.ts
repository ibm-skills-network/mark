import { Injectable, Logger } from "@nestjs/common";
import { EmailService, EmailOptions } from "src/common/services/email.service";

/**
 * AdminEmailService handles admin-specific email operations.
 * Uses the general EmailService for actual email delivery.
 */
@Injectable()
export class AdminEmailService {
  private readonly logger = new Logger(AdminEmailService.name);

  constructor(private readonly emailService: EmailService) {}

  /**
   * Send verification code email to admin
   */
  async sendVerificationCode(email: string, code: string): Promise<boolean> {
    try {
      const emailOptions: EmailOptions = {
        to: email,
        subject: "Mark Admin Access - Verification Code",
        html: this.getEmailTemplate(code),
        text: this.getPlainTextTemplate(code),
        from: {
          email:
            process.env.SENDGRID_FROM_EMAIL ||
            process.env.GMAIL_USER ||
            "noreply@markapp.com",
          name: "Mark Admin System",
        },
      };

      const result = await this.emailService.sendEmail(emailOptions);

      if (!result) {
        this.logger.error(`Failed to send verification code to ${email}`);
      }

      return result;
    } catch (error) {
      this.logger.error(`Failed to send verification code to ${email}:`, error);
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
    return await this.emailService.testConnection();
  }

  /**
   * Send a test email to verify configuration
   */
  async sendTestEmail(toEmail: string): Promise<boolean> {
    try {
      const emailOptions: EmailOptions = {
        to: toEmail,
        subject: "Mark Admin - Email Configuration Test",
        html: `
          <h2>🎉 Email Configuration Test</h2>
          <p>If you received this email, your email configuration is working correctly!</p>
          <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
          <p><em>This is a test message from Mark Admin System.</em></p>
        `,
        text: `
Email Configuration Test

If you received this email, your email configuration is working correctly!

Timestamp: ${new Date().toISOString()}

This is a test message from Mark Admin System.
        `,
        from: {
          email:
            process.env.SENDGRID_FROM_EMAIL ||
            process.env.GMAIL_USER ||
            "noreply@markapp.com",
          name: "Mark Admin System",
        },
      };

      return await this.emailService.sendEmail(emailOptions);
    } catch (error) {
      this.logger.error(`Failed to send test email to ${toEmail}:`, error);
      return false;
    }
  }
}
