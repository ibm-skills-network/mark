import { EmailSuppressionReason } from "@prisma/client";
import * as nodemailer from "nodemailer";
import { AdminEmailService } from "./admin-email.service";
import { EmailSuppressionService } from "./email-suppression.service";

jest.mock("nodemailer", () => ({ createTransport: jest.fn() }));

interface SentMessage {
  from: { name: string; address: string };
  to: string;
  subject: string;
  html: string;
  text: string;
}

const createTransport = (
  nodemailer as unknown as { createTransport: jest.Mock }
).createTransport;

const HELP_URL = "https://support.skills.network";
const ENV_KEYS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "EMAIL_FROM",
  "EMAIL_FROM_NAME",
  "EMAIL_HELP_URL",
  "WEB_APP_URL",
  "NODE_ENV",
] as const;

describe("AdminEmailService", () => {
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};
  let transport: { sendMail: jest.Mock; verify: jest.Mock };
  let suppressions: { isSuppressed: jest.Mock; suppress: jest.Mock };

  const makeService = () =>
    new AdminEmailService(suppressions as unknown as EmailSuppressionService);

  const sentMessage = (): SentMessage => {
    expect(transport.sendMail).toHaveBeenCalledTimes(1);
    return transport.sendMail.mock.calls[0][0] as SentMessage;
  };

  const expectHelpLink = (message: SentMessage) => {
    expect(message.html).toContain(`href="${HELP_URL}"`);
    expect(message.text).toContain(`Need help? Visit ${HELP_URL}`);
  };

  beforeAll(() => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  });

  afterAll(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  beforeEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.NODE_ENV = "production";
    process.env.SMTP_USER = "mark-smtp-user";
    process.env.SMTP_PASSWORD = "test-api-key"; // pragma: allowlist secret
    process.env.WEB_APP_URL = "https://mark.skills.network";

    transport = {
      sendMail: jest.fn().mockResolvedValue({ messageId: "id" }),
      verify: jest.fn().mockResolvedValue(true),
    };
    createTransport.mockReset().mockReturnValue(transport);
    suppressions = {
      isSuppressed: jest.fn().mockResolvedValue(false),
      suppress: jest.fn().mockResolvedValue({}),
    };
  });

  describe("transport", () => {
    it("connects to Event Notifications over STARTTLS by default", () => {
      makeService();

      expect(createTransport).toHaveBeenCalledWith({
        host: "smtp.us-south.event-notifications.cloud.ibm.com",
        port: 587,
        secure: false,
        requireTLS: true,
        auth: { user: "mark-smtp-user", pass: "test-api-key" },
      });
    });

    it("uses implicit TLS on port 465", () => {
      process.env.SMTP_PORT = "465";
      makeService();

      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ port: 465, secure: true, requireTLS: false }),
      );
    });

    it("sends from the verified skills.network domain by default", async () => {
      await makeService().sendTestEmail("admin@example.com");

      expect(sentMessage().from).toEqual({
        name: "Mark",
        address: "noreply@mark.skills.network",
      });
    });

    it("uses the configured sender and help link", async () => {
      process.env.EMAIL_FROM = "noreply@mark.staging.skills.network";
      process.env.EMAIL_FROM_NAME = "Mark (staging)";
      process.env.EMAIL_HELP_URL = "https://support.staging.skills.network";

      await makeService().sendTestEmail("admin@example.com");

      const message = sentMessage();
      expect(message.from).toEqual({
        name: "Mark (staging)",
        address: "noreply@mark.staging.skills.network",
      });
      expect(message.text).toContain(
        "Need help? Visit https://support.staging.skills.network",
      );
    });

    it("drops mail with an error in production when SMTP is not configured", async () => {
      delete process.env.SMTP_USER;
      const service = makeService();

      expect(createTransport).not.toHaveBeenCalled();
      await expect(
        service.sendGradingCompletionEmail("learner@example.com", 1, 2, 90),
      ).resolves.toBe(false);
      await expect(service.testConnection()).resolves.toBe(false);
    });

    it("logs mail to the console in development when SMTP is not configured", async () => {
      process.env.NODE_ENV = "development";
      delete process.env.SMTP_PASSWORD;

      await expect(
        makeService().sendVerificationCode("admin@example.com", "123456"),
      ).resolves.toBe(true);
    });

    it("verifies the SMTP connection", async () => {
      const service = makeService();
      await expect(service.testConnection()).resolves.toBe(true);

      transport.verify.mockRejectedValueOnce(new Error("auth failed"));
      await expect(service.testConnection()).resolves.toBe(false);
    });
  });

  describe("templates", () => {
    it("admin verification code", async () => {
      await expect(
        makeService().sendVerificationCode("admin@example.com", "482913"),
      ).resolves.toBe(true);

      const message = sentMessage();
      expect(message.to).toBe("admin@example.com");
      expect(message.subject).toBe("Mark admin verification code");
      expect(message.html).toContain("482913");
      expect(message.text).toContain("Admin verification code: 482913");
      expect(message.text).toContain("expires in 10 minutes");
      expectHelpLink(message);
    });

    it("email configuration test", async () => {
      await expect(
        makeService().sendTestEmail("admin@example.com"),
      ).resolves.toBe(true);

      const message = sentMessage();
      expect(message.to).toBe("admin@example.com");
      expect(message.subject).toBe("Mark email configuration test");
      expect(message.text).toContain("sending email is working");
      expectHelpLink(message);
    });

    it("grading complete, with a score", async () => {
      await expect(
        makeService().sendGradingCompletionEmail(
          "learner@example.com",
          12,
          77,
          84.6,
        ),
      ).resolves.toBe(true);

      const message = sentMessage();
      const resultsUrl =
        "https://mark.skills.network/learner/12/successPage/77";
      expect(message.to).toBe("learner@example.com");
      expect(message.subject).toBe("Your assignment has been graded");
      expect(message.html).toContain(`href="${resultsUrl}"`);
      expect(message.html).toContain("85%");
      expect(message.text).toContain(`View your results: ${resultsUrl}`);
      expect(message.text).toContain("Score: 85%");
      expect(message.text).toContain("you asked to be notified");
      expectHelpLink(message);
    });

    it("grading complete, without a score", async () => {
      await makeService().sendGradingCompletionEmail(
        "learner@example.com",
        12,
        77,
      );

      const message = sentMessage();
      expect(message.text).not.toContain("Score:");
      expect(message.html).not.toContain("%</p>");
    });

    it("bug renewal reminder", async () => {
      const renewLink =
        "https://mark.skills.network/api/v1/reports/renewal/renew?token=abc&x=1";
      const closeLink =
        "https://mark.skills.network/api/v1/reports/renewal/close?token=def";

      await expect(
        makeService().sendBugRenewalEmail(
          "reporter@example.com",
          "Upload fails",
          "The upload button does nothing.",
          renewLink,
          closeLink,
          "2026-09-01T12:00:00Z",
          1639,
        ),
      ).resolves.toBe(true);

      const message = sentMessage();
      expect(message.to).toBe("reporter@example.com");
      expect(message.subject).toBe("Are you still experiencing this issue?");
      expect(message.html).toContain(
        `href="${renewLink.replace("&", "&amp;")}"`,
      );
      expect(message.html).toContain(`href="${closeLink}"`);
      expect(message.html).toContain("Issue #1639");
      expect(message.text).toContain(`Yes, still happening: ${renewLink}`);
      expect(message.text).toContain(`No, resolved: ${closeLink}`);
      expectHelpLink(message);
    });

    it("bug renewal reminder escapes report content", async () => {
      await makeService().sendBugRenewalEmail(
        "reporter@example.com",
        '<a href="https://evil.example">title</a>',
        "<script>alert(1)</script>",
        "https://mark.skills.network/renew",
        "https://mark.skills.network/close",
        "<img src=x>",
      );

      const { html } = sentMessage();
      expect(html).not.toContain("<script>");
      expect(html).not.toContain('<a href="https://evil.example">');
      expect(html).not.toContain("<img src=x>");
      expect(html).toContain("&lt;script&gt;");
    });

    it("plain-text notices (LTI sync and report updates) escape their body", async () => {
      await expect(
        makeService().sendGenericEmail(
          "reporter@example.com",
          "Update on your report #42",
          'New developer comment:\n\n<b>fixed</b> <a href="https://evil.example">here</a>',
        ),
      ).resolves.toBe(true);

      const message = sentMessage();
      expect(message.to).toBe("reporter@example.com");
      expect(message.subject).toBe("Update on your report #42");
      expect(message.html).toContain("&lt;b&gt;fixed&lt;/b&gt;");
      expect(message.html).not.toContain('<a href="https://evil.example">');
      expect(message.text).toContain("<b>fixed</b>");
      expectHelpLink(message);
    });

    it("builds absolute learner results links", () => {
      expect(makeService().learnerResultsUrl(5, 9)).toBe(
        "https://mark.skills.network/learner/5/successPage/9",
      );
    });
  });

  describe("recipients", () => {
    it.each([
      "anonymous",
      "a@example.com, b@example.com",
      "Name <a@example.com>",
      "a@example.com\nBcc: b@example.com",
      "",
    ])("refuses to send to %j", async (to) => {
      await expect(
        makeService().sendGenericEmail(to, "Subject", "Body"),
      ).resolves.toBe(false);
      expect(transport.sendMail).not.toHaveBeenCalled();
    });

    it("does not send to a suppressed address", async () => {
      suppressions.isSuppressed.mockResolvedValue(true);

      await expect(
        makeService().sendGradingCompletionEmail("gone@example.com", 1, 2, 50),
      ).resolves.toBe(false);
      expect(suppressions.isSuppressed).toHaveBeenCalledWith(
        "gone@example.com",
      );
      expect(transport.sendMail).not.toHaveBeenCalled();
    });
  });

  describe("failures", () => {
    const smtpError = (
      command: string,
      responseCode: number,
      response: string,
    ) =>
      Object.assign(new Error("Can't send mail"), {
        code: "EENVELOPE",
        command,
        responseCode,
        response,
      });

    it("suppresses an address the server rejects as permanently undeliverable", async () => {
      transport.sendMail.mockRejectedValueOnce(
        smtpError("RCPT TO", 550, "550 5.1.1 <gone@example.com>: User unknown"),
      );

      await expect(
        makeService().sendGenericEmail("gone@example.com", "Subject", "Body"),
      ).resolves.toBe(false);
      expect(suppressions.suppress).toHaveBeenCalledWith(
        "gone@example.com",
        EmailSuppressionReason.HARD_BOUNCE,
        "550 5.1.1 <gone@example.com>: User unknown",
        "system",
      );
    });

    it.each([
      ["a temporary failure", "RCPT TO", 451, "451 4.2.1 Mailbox busy"],
      ["a policy rejection", "RCPT TO", 550, "550 5.7.1 Relaying denied"],
      ["a sender rejection", "MAIL FROM", 553, "553 5.1.8 Sender rejected"],
      ["an authentication failure", "AUTH PLAIN", 535, "535 5.7.8 Bad auth"],
    ])(
      "does not suppress the recipient on %s",
      async (_, command, code, response) => {
        transport.sendMail.mockRejectedValueOnce(
          smtpError(command, code, response),
        );

        await expect(
          makeService().sendGenericEmail("learner@example.com", "S", "B"),
        ).resolves.toBe(false);
        expect(suppressions.suppress).not.toHaveBeenCalled();
      },
    );

    it("reports a network failure as not sent", async () => {
      transport.sendMail.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      await expect(
        makeService().sendVerificationCode("admin@example.com", "111111"),
      ).resolves.toBe(false);
      expect(suppressions.suppress).not.toHaveBeenCalled();
    });

    it("still reports not sent when recording the suppression fails", async () => {
      transport.sendMail.mockRejectedValueOnce(
        smtpError("RCPT TO", 550, "550 5.1.1 User unknown"),
      );
      suppressions.suppress.mockRejectedValueOnce(new Error("db down"));

      await expect(
        makeService().sendGenericEmail("gone@example.com", "S", "B"),
      ).resolves.toBe(false);
    });
  });
});
