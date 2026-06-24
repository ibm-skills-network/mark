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
