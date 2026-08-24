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
    const forwardPrisma = {
      report: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 7 }),
      },
    };
    const floService = { sendError: jest.fn().mockResolvedValue(undefined) };
    const service = new ReportsService(
      floService as never,
      forwardPrisma as never,
      undefined as never,
      undefined as never,
      snSupportService as never,
    );
    jest
      .spyOn(
        service as unknown as {
          createGithubIssue: () => Promise<{ number: number }>;
        },
        "createGithubIssue",
      )
      .mockResolvedValue({ number: 123 });
    return service;
  };

  it("forwards the report to SN Support with Mark context", async () => {
    const snSupportService = {
      isConfigured: jest.fn().mockReturnValue(true),
      createTicket: jest.fn().mockResolvedValue({ ticketKey: "SUPPORT-1" }),
    };

    const result = await makeForReportIssue(snSupportService).reportIssue(
      reportDto,
      session,
    );

    expect(result.issueNumber).toBe(123);
    expect(snSupportService.createTicket).toHaveBeenCalledWith({
      title: expect.stringContaining("Assignment 42 - Attempt 84"),
      description: expect.stringContaining("The assignment submission fails"),
      reporterEmail: "employee@ibm.com",
      issueType: "Submission",
      pageUrl: undefined,
      portalName: "Coursera",
      courseTitle: undefined,
      toolName: "Mark",
      browser: undefined,
      chatHistoryUrl: undefined,
      screenshotUrl: undefined,
    });
    const sentTitle = snSupportService.createTicket.mock.calls[0][0].title;
    expect(sentTitle).not.toContain("[MARK CHAT]");
    expect(sentTitle).not.toContain("[PROD]");
  });

  it("still files the GitHub issue when SN Support is down", async () => {
    const snSupportService = {
      isConfigured: jest.fn().mockReturnValue(true),
      createTicket: jest.fn().mockRejectedValue(new Error("sn down")),
    };

    const result = await makeForReportIssue(snSupportService).reportIssue(
      reportDto,
      session,
    );

    expect(snSupportService.createTicket).toHaveBeenCalled();
    expect(result.issueNumber).toBe(123);
  });

  it("skips the SN forward when the reporter email is unknown", async () => {
    const snSupportService = {
      isConfigured: jest.fn().mockReturnValue(true),
      createTicket: jest.fn(),
    };

    const result = await makeForReportIssue(snSupportService).reportIssue(
      reportDto,
      { assignmentId: 42, attemptId: 84 },
    );

    expect(snSupportService.createTicket).not.toHaveBeenCalled();
    expect(result.issueNumber).toBe(123);
  });

  it("skips the SN forward when the integration is not configured", async () => {
    const snSupportService = {
      isConfigured: jest.fn().mockReturnValue(false),
      createTicket: jest.fn(),
    };

    const result = await makeForReportIssue(snSupportService).reportIssue(
      reportDto,
      session,
    );

    expect(snSupportService.createTicket).not.toHaveBeenCalled();
    expect(result.issueNumber).toBe(123);
  });
});
