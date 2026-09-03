import "reflect-metadata";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ReportsService } from "./report.service";

// sendBugRenewalEmail only touches prisma (report read/update) and the email
// service, so the other constructor deps can be left unmocked.
const prisma = {
  report: {
    findFirst: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
  },
};
const adminEmailService = {
  sendBugRenewalEmail: jest.fn().mockResolvedValue(true),
};

const make = () =>
  new ReportsService(
    undefined as never,
    prisma as never,
    undefined as never,
    adminEmailService as never,
    undefined as never,
  );

const baseReport = {
  id: 42,
  issueNumber: 1639,
  reporterId: "reporter@example.com",
  description: "some description",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  renewalEmailSentAt: null,
};

describe("ReportsService.sendBugRenewalEmail", () => {
  beforeEach(() => jest.clearAllMocks());

  it("sends to the report's own reporter", async () => {
    prisma.report.findFirst.mockResolvedValue({ ...baseReport });

    const result = await make().sendBugRenewalEmail({ issueNumber: 1639 });

    expect(adminEmailService.sendBugRenewalEmail).toHaveBeenCalledTimes(1);
    expect(adminEmailService.sendBugRenewalEmail.mock.calls[0][0]).toBe(
      "reporter@example.com",
    );
    expect(prisma.report.update).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it("ignores any caller-supplied recipient (not overridable)", async () => {
    prisma.report.findFirst.mockResolvedValue({ ...baseReport });

    // userEmail is no longer on the DTO; prove it's ignored even if smuggled in.
    await make().sendBugRenewalEmail({
      issueNumber: 1639,
      userEmail: "attacker@evil.com",
    } as never);

    expect(adminEmailService.sendBugRenewalEmail.mock.calls[0][0]).toBe(
      "reporter@example.com",
    );
  });

  it("skips when a renewal email was already sent within the TTL", async () => {
    prisma.report.findFirst.mockResolvedValue({
      ...baseReport,
      renewalEmailSentAt: new Date(),
    });

    const result = await make().sendBugRenewalEmail({ issueNumber: 1639 });

    expect(result.skipped).toBe(true);
    expect(adminEmailService.sendBugRenewalEmail).not.toHaveBeenCalled();
  });

  it("re-sends when renewalEmailSentAt is older than the 7-day TTL", async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    prisma.report.findFirst.mockResolvedValue({
      ...baseReport,
      renewalEmailSentAt: eightDaysAgo,
    });

    const result = await make().sendBugRenewalEmail({ issueNumber: 1639 });

    expect(adminEmailService.sendBugRenewalEmail).toHaveBeenCalledTimes(1);
    expect(result.skipped).toBeFalsy();
    expect(result.success).toBe(true);
  });

  it("throws NotFound when the report does not exist", async () => {
    prisma.report.findFirst.mockResolvedValue(null);
    await expect(
      make().sendBugRenewalEmail({ issueNumber: 9999 }),
    ).rejects.toThrow(NotFoundException);
  });

  it("throws BadRequest when the reporter has no email", async () => {
    prisma.report.findFirst.mockResolvedValue({
      ...baseReport,
      reporterId: null,
    });
    await expect(
      make().sendBugRenewalEmail({ issueNumber: 1639 }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe("ReportsService.reportIssue", () => {
  const reportDto = {
    issueType: "technical",
    description: "The assignment submission fails",
    attemptId: 84,
    additionalDetails: {
      category: "Submission",
      portalName: "Coursera",
    },
  };
  const session = {
    assignmentId: 42,
    attemptId: 84,
    userId: "employee@ibm.com",
  };

  const makeForReportIssue = (snSupportService: unknown) => {
    const prisma = {
      report: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 7 }),
      },
    };
    const floService = { sendError: jest.fn().mockResolvedValue(undefined) };
    const supportRouting = {
      resolve: jest.fn().mockResolvedValue({
        token: "sk_coursera",
        productName: "Coursera",
        via: "portal-manager",
      }),
    };
    const service = new ReportsService(
      floService as never,
      prisma as never,
      undefined as never,
      undefined as never,
      snSupportService as never,
      supportRouting as never,
    );
    return { service, prisma, floService, supportRouting };
  };

  it("creates the SN Support ticket with Mark context and no GitHub issue", async () => {
    const snSupportService = {
      isConfigured: jest.fn().mockReturnValue(true),
      createTicket: jest.fn().mockResolvedValue({ ticketKey: "SUPPORT-1" }),
    };

    const { service, prisma } = makeForReportIssue(snSupportService);
    const result = await service.reportIssue(reportDto, session);

    expect(result.reportId).toBe(7);
    expect(result.message).toContain("SUPPORT-1");
    // The DB row is the record now — no GitHub issue number anywhere.
    expect(
      prisma.report.create.mock.calls[0][0].data.issueNumber,
    ).toBeUndefined();
    expect(snSupportService.createTicket).toHaveBeenCalledWith(
      {
        title: expect.stringContaining("Assignment 42 - Attempt 84"),
        description: expect.stringContaining("The assignment submission fails"),
        reporterEmail: "employee@ibm.com",
        severity: "error",
        issueType: "Submission",
        pageUrl: undefined,
        portalName: "Coursera",
        portalUrl: undefined,
        courseTitle: undefined,
        toolName: "Mark",
        browser: undefined,
        chatHistoryUrl: undefined,
        screenshotUrl: undefined,
      },
      // The product-scoped key is what routes the ticket to Coursera.
      "sk_coursera",
    );
    const sentTitle = snSupportService.createTicket.mock.calls[0][0].title;
    expect(sentTitle).not.toContain("[MARK CHAT]");
    expect(sentTitle).not.toContain("[PROD]");
  });

  it("forwards the portal and client context to SN Support and Flo", async () => {
    const snSupportService = {
      isConfigured: jest.fn().mockReturnValue(true),
      createTicket: jest.fn().mockResolvedValue({ ticketKey: "SUPPORT-9" }),
    };

    const { service, floService } = makeForReportIssue(snSupportService);
    await service.reportIssue(
      {
        ...reportDto,
        additionalDetails: {
          ...reportDto.additionalDetails,
          portalUrl: "https://www.coursera.org",
          pageUrl: "https://mark.skills.network/learner/42/questions",
          browser: "Chrome 141 on macOS",
        },
      },
      session,
    );

    expect(snSupportService.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        portalName: "Coursera",
        portalUrl: "https://www.coursera.org",
        pageUrl: "https://mark.skills.network/learner/42/questions",
        browser: "Chrome 141 on macOS",
      }),
      "sk_coursera",
    );
    // Flo's portal_name / portal_url were the fields reported as always null.
    expect(floService.sendError).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        portalName: "Coursera",
        portalUrl: "https://www.coursera.org",
      }),
    );
  });

  it("forwards flag-button reports with a symptom title and plain-text body", async () => {
    const snSupportService = {
      isConfigured: jest.fn().mockReturnValue(true),
      createTicket: jest.fn().mockResolvedValue({ ticketKey: "SUPPORT-2" }),
    };

    // The flag-button modal pre-composes the description into markdown
    // sections and lets the reporter pick a severity.
    await makeForReportIssue(snSupportService).service.reportIssue(
      {
        ...reportDto,
        issueType: "other",
        severity: "info",
        description:
          "**Steps to reproduce:**\nOpen the quiz\n\n**Actual result:**\nSpinner never stops",
      },
      session,
    );

    const sent = snSupportService.createTicket.mock.calls[0][0];
    expect(sent.severity).toBe("info");
    expect(sent.title).toContain("Spinner never stops");
    expect(sent.title).not.toContain("Steps to reproduce");
    expect(sent.title).not.toContain("**");
    expect(sent.description).toContain("Steps to reproduce:");
    expect(sent.description).not.toContain("**");
  });

  it("still records the report when SN Support is down", async () => {
    const snSupportService = {
      isConfigured: jest.fn().mockReturnValue(true),
      createTicket: jest.fn().mockRejectedValue(new Error("sn down")),
    };

    const { service, prisma } = makeForReportIssue(snSupportService);
    const result = await service.reportIssue(reportDto, session);

    expect(snSupportService.createTicket).toHaveBeenCalled();
    expect(prisma.report.create).toHaveBeenCalled();
    expect(result.reportId).toBe(7);
    expect(result.message).not.toContain("SUPPORT");
  });

  it("records anonymous reports as DB rows without an SN ticket", async () => {
    const snSupportService = {
      isConfigured: jest.fn().mockReturnValue(true),
      createTicket: jest.fn(),
    };

    const { service, prisma } = makeForReportIssue(snSupportService);
    const result = await service.reportIssue(reportDto, {
      assignmentId: 42,
      attemptId: 84,
    });

    expect(snSupportService.createTicket).not.toHaveBeenCalled();
    expect(prisma.report.create).toHaveBeenCalled();
    expect(result.reportId).toBe(7);
  });

  it("records the report when the SN integration is not configured", async () => {
    const snSupportService = {
      isConfigured: jest.fn().mockReturnValue(false),
      createTicket: jest.fn(),
    };

    const { service, prisma } = makeForReportIssue(snSupportService);
    const result = await service.reportIssue(reportDto, session);

    expect(snSupportService.createTicket).not.toHaveBeenCalled();
    expect(prisma.report.create).toHaveBeenCalled();
    expect(result.reportId).toBe(7);
  });
});
