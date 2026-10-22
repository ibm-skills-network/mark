import "reflect-metadata";
import { BadRequestException, Logger, NotFoundException } from "@nestjs/common";
import sharp from "sharp";
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

  it("skips, without throwing, when no report exists for the issue", async () => {
    prisma.report.findFirst.mockResolvedValue(null);
    const result = await make().sendBugRenewalEmail({ issueNumber: 9999 });
    expect(result).toEqual(
      expect.objectContaining({ success: false, skipped: true }),
    );
    expect(adminEmailService.sendBugRenewalEmail).not.toHaveBeenCalled();
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
    portal: { portalHost: "coursera.org", portalName: "Coursera" },
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

  const makeForReportIssue = (
    snSupportService: unknown,
    filesService: unknown = undefined,
  ) => {
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
      filesService as never,
      undefined as never,
      snSupportService as never,
      supportRouting as never,
    );
    return { service, prisma, floService, supportRouting };
  };

  describe("report diagnostics", () => {
    const diagnostics = {
      v: 1 as const,
      session: { attemptId: 84, attemptLanguage: "es" },
      rendered: [
        {
          questionId: 1,
          choices: [{ text: "Apache Kafka and Apache Flink", selected: true }],
        },
      ],
      requests: [
        {
          method: "PATCH",
          path: "/api/v2/assignments/42/attempts/84",
          status: 504,
        },
      ],
    };
    const sn = () => ({
      isConfigured: jest.fn().mockReturnValue(true),
      createTicket: jest.fn().mockResolvedValue({ ticketKey: "SUPPORT-3" }),
    });
    const withDiagnosticsTable = (
      prisma: Record<string, unknown>,
      create: jest.Mock,
    ) => {
      prisma.reportDiagnostics = { create };
    };

    it("stores the capture against the new report", async () => {
      const { service, prisma } = makeForReportIssue(sn());
      const create = jest.fn().mockResolvedValue({ id: 1 });
      withDiagnosticsTable(prisma, create);

      await service.reportIssue({ ...reportDto, diagnostics }, session);

      expect(create).toHaveBeenCalledWith({
        data: { reportId: 7, data: diagnostics },
      });
    });

    it("gives the support ticket a one-line summary, never the capture", async () => {
      const snSupportService = sn();
      const { service, prisma } = makeForReportIssue(snSupportService);
      withDiagnosticsTable(prisma, jest.fn().mockResolvedValue({ id: 1 }));

      await service.reportIssue({ ...reportDto, diagnostics }, session);

      const sent = snSupportService.createTicket.mock.calls[0][0].description;
      expect(sent).toContain("Diagnostics captured: attempt 84, language es");
      expect(sent).not.toContain("Apache Kafka");
    });

    it("still files the report when the capture cannot be stored", async () => {
      const { service, prisma } = makeForReportIssue(sn());
      withDiagnosticsTable(
        prisma,
        jest.fn().mockRejectedValue(new Error("db unavailable")),
      );

      const result = await service.reportIssue(
        { ...reportDto, diagnostics },
        session,
      );

      expect(result.reportId).toBe(7);
    });

    it("writes nothing when the report carries no capture", async () => {
      const { service, prisma } = makeForReportIssue(sn());
      const create = jest.fn();
      withDiagnosticsTable(prisma, create);

      await service.reportIssue(reportDto, session);

      expect(create).not.toHaveBeenCalled();
    });

    it("reads a stored capture back for the admin route", async () => {
      const { service, prisma } = makeForReportIssue(sn());
      const createdAt = new Date("2026-09-17T15:00:00Z");
      prisma.reportDiagnostics = {
        findUnique: jest
          .fn()
          .mockResolvedValue({ reportId: 7, data: diagnostics, createdAt }),
      };

      await expect(service.getReportDiagnostics(7)).resolves.toEqual({
        reportId: 7,
        capturedAt: createdAt,
        diagnostics,
      });
    });

    it("answers not-found when a report has no capture", async () => {
      const { service, prisma } = makeForReportIssue(sn());
      prisma.reportDiagnostics = {
        findUnique: jest.fn().mockResolvedValue(null),
      };

      await expect(service.getReportDiagnostics(7)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

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
        screenshotUrls: undefined,
      },
      // The product-scoped key is what routes the ticket to Coursera.
      "sk_coursera",
    );
    const sentTitle = snSupportService.createTicket.mock.calls[0][0].title;
    expect(sentTitle).not.toContain("[MARK CHAT]");
    expect(sentTitle).not.toContain("[PROD]");
  });

  it("does not route using untrusted additionalDetails", async () => {
    const snSupportService = {
      isConfigured: jest.fn().mockReturnValue(true),
      createTicket: jest.fn().mockResolvedValue({ ticketKey: "SUPPORT-9" }),
    };
    const { service, supportRouting } = makeForReportIssue(snSupportService);
    await service.reportIssue(
      {
        ...reportDto,
        portal: {},
        additionalDetails: {
          portalName: "ICE",
          portalUrl: "https://forged.example",
        },
      },
      session,
    );
    expect(supportRouting.resolve).toHaveBeenCalledWith({
      portalHost: undefined,
      portalName: undefined,
      portalUrl: undefined,
    });
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
        portal: { ...reportDto.portal, portalUrl: "https://www.coursera.org" },
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

  it("reports the launch's course to SN Support over the client's", async () => {
    const snSupportService = {
      isConfigured: jest.fn().mockReturnValue(true),
      createTicket: jest.fn().mockResolvedValue({ ticketKey: "SUPPORT-9" }),
    };

    await makeForReportIssue(snSupportService).service.reportIssue(
      {
        ...reportDto,
        portal: {
          ...reportDto.portal,
          courseTitle: "Java Development with Databases",
        },
        additionalDetails: {
          ...reportDto.additionalDetails,
          courseTitle: "Client Claimed Course",
        },
      },
      session,
    );

    expect(snSupportService.createTicket.mock.calls[0][0].courseTitle).toBe(
      "Java Development with Databases",
    );
  });

  it("forwards the course id, item and LMS family to SN Support", async () => {
    const snSupportService = {
      isConfigured: jest.fn().mockReturnValue(true),
      createTicket: jest.fn().mockResolvedValue({ ticketKey: "SUPPORT-9" }),
    };

    await makeForReportIssue(snSupportService).service.reportIssue(
      {
        ...reportDto,
        portal: {
          ...reportDto.portal,
          courseId: "ondemand~1WEwdGF8Ee-e0g4kKcdYJQ",
          activityTitle: "Option 1: AI-Graded Submission and Evaluation",
          lmsFamily: "ims",
        },
      },
      session,
    );

    expect(snSupportService.createTicket.mock.calls[0][0]).toMatchObject({
      courseId: "ondemand~1WEwdGF8Ee-e0g4kKcdYJQ",
      activityTitle: "Option 1: AI-Graded Submission and Evaluation",
      lmsFamily: "ims",
    });
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
  describe("routing away from SN Support", () => {
    const sn = () => ({
      isConfigured: jest.fn().mockReturnValue(true),
      createTicket: jest.fn().mockResolvedValue({ ticketKey: "SUPPORT-4" }),
    });
    const diagnostics = {
      v: 1 as const,
      session: { attemptId: 84 },
    };
    let logSpy: jest.SpyInstance;
    beforeEach(() => {
      logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation();
    });
    afterEach(() => logSpy.mockRestore());

    const filler =
      "**Steps to reproduce:**\r\nno\r\n\r\n**Expected result:**\r\nno\r\n\r\n**Actual result:**\r\nok";

    it("records a report with no usable text without filing a ticket", async () => {
      const snSupportService = sn();
      const { service, prisma, supportRouting } =
        makeForReportIssue(snSupportService);
      const create = jest.fn().mockResolvedValue({ id: 1 });
      (prisma as Record<string, unknown>).reportDiagnostics = { create };

      const result = await service.reportIssue(
        {
          ...reportDto,
          issueType: "BUG",
          description: filler,
          diagnostics,
          additionalDetails: { category: "Flag Button Report" },
        },
        session,
      );

      expect(snSupportService.createTicket).not.toHaveBeenCalled();
      expect(supportRouting.resolve).not.toHaveBeenCalled();
      const row = prisma.report.create.mock.calls[0][0].data;
      expect(row.description).toBe(filler);
      expect(row.status).toBe("CLOSED");
      expect(row.closureReason).toBe("junk");
      expect(create).toHaveBeenCalledWith({
        data: { reportId: 7, data: diagnostics },
      });
      expect(logSpy).toHaveBeenCalledWith(
        "Report recorded without an SN Support ticket",
        expect.objectContaining({
          report_id: 7,
          user_id: "employee@ibm.com",
          assignment_id: 42,
          reason: "filler_only",
        }),
      );
    });

    it("answers a junk report exactly like any report filed without a ticket", async () => {
      const junk = makeForReportIssue(sn());
      const junkResult = await junk.service.reportIssue(
        { ...reportDto, description: "." },
        session,
      );

      const offline = makeForReportIssue({
        isConfigured: jest.fn().mockReturnValue(false),
        createTicket: jest.fn(),
      });
      const offlineResult = await offline.service.reportIssue(
        reportDto,
        session,
      );

      expect(junkResult).toEqual(offlineResult);
    });

    it("still files an error-dialog report the reporter typed nothing into", async () => {
      const snSupportService = sn();
      const { service } = makeForReportIssue(snSupportService);

      await service.reportIssue(
        {
          ...reportDto,
          description:
            "**Steps to reproduce:**\r\n1. I was using /learner/42 normally.\r\n2. The error dialog appeared.\r\n(Auto-filled — please describe what you were doing if you can.)\r\n\r\n**Actual result:**\r\nAn error dialog appeared:\r\nStatus: 500 — Something went wrong",
          additionalDetails: { category: "Error Dialog Report" },
        },
        session,
      );

      expect(snSupportService.createTicket).toHaveBeenCalled();
    });

    it.each(["FALSE_MARKING", "grading", "false marking"])(
      "records a grading dispute (%s) without filing a ticket",
      async (issueType) => {
        const snSupportService = sn();
        const { service, prisma } = makeForReportIssue(snSupportService);
        const create = jest.fn().mockResolvedValue({ id: 1 });
        (prisma as Record<string, unknown>).reportDiagnostics = { create };

        const result = await service.reportIssue(
          {
            ...reportDto,
            issueType,
            description: "Question 3 was marked wrong but matches the slides",
            diagnostics,
          },
          session,
        );

        expect(snSupportService.createTicket).not.toHaveBeenCalled();
        const row = prisma.report.create.mock.calls[0][0].data;
        expect(row.issueType).toBe("FALSE_MARKING");
        expect(row.status).toBe("OPEN");
        expect(row.closureReason).toBeNull();
        expect(create).toHaveBeenCalled();
        expect(result.reportId).toBe(7);
        expect(result.message).toContain("recorded for review");
        expect(result.message).not.toMatch(/ticket|email/i);
        expect(logSpy).toHaveBeenCalledWith(
          "Report recorded without an SN Support ticket",
          expect.objectContaining({
            report_id: 7,
            reason: "grading_dispute",
          }),
        );
      },
    );

    it("still files a bug report with real text", async () => {
      const snSupportService = sn();
      const { service, prisma } = makeForReportIssue(snSupportService);

      const result = await service.reportIssue(
        { ...reportDto, issueType: "BUG", description: "Q3 answer key wrong" },
        session,
      );

      expect(snSupportService.createTicket).toHaveBeenCalledTimes(1);
      expect(prisma.report.create.mock.calls[0][0].data.status).toBe("OPEN");
      expect(result.message).toContain("SUPPORT-4");
    });

    it("shows the reporter a junk report as an ordinary open report", async () => {
      const { service, prisma } = makeForReportIssue(sn());
      (prisma.report.findMany as jest.Mock).mockResolvedValueOnce([
        {
          id: 7,
          reporterId: "employee@ibm.com",
          status: "CLOSED",
          closureReason: "junk",
          statusMessage: "Not forwarded to support: filler_only",
          duplicateOfReportId: null,
        },
      ]);

      const [shown] = await service.getReportsForUser("employee@ibm.com");

      expect(shown.status).toBe("OPEN");
      expect(shown.closureReason).toBeNull();
      expect(shown.statusMessage).toBe(
        "Your issue has been reported and is being reviewed.",
      );
    });
  });

  describe("report screenshots", () => {
    let png: Buffer;
    beforeAll(async () => {
      png = await sharp({
        create: {
          width: 2,
          height: 2,
          channels: 3,
          background: "#fff",
        },
      })
        .png()
        .toBuffer();
    });
    const asUpload = (buffer: Buffer, mimetype = "image/png") =>
      ({
        buffer,
        size: buffer.length,
        mimetype,
        originalname: "my screen shot.png",
      }) as Express.Multer.File;
    const sn = () => ({
      isConfigured: jest.fn().mockReturnValue(true),
      createTicket: jest.fn().mockResolvedValue({ ticketKey: "SUPPORT-5" }),
    });
    const env = { ...process.env };

    beforeEach(() => {
      process.env.IBM_COS_DEBUG_BUCKET = "debug-bkt";
      process.env.IBM_COS_ENDPOINT = "https://s3.example.com/";
    });
    afterEach(() => {
      process.env = { ...env };
    });

    it("stores the image public-read under a random key and sends its URL", async () => {
      const snSupportService = sn();
      const filesService = { directUpload: jest.fn().mockResolvedValue({}) };
      const { service } = makeForReportIssue(snSupportService, filesService);

      await service.reportIssue(reportDto, session, asUpload(png, "text/html"));

      const [, bucket, key, options] = filesService.directUpload.mock.calls[0];
      expect(bucket).toBe("debug-bkt");
      expect(key).toMatch(/^issue-screenshots\/[\da-f-]{36}\.png$/);
      // The sniffed type wins over the client's claim.
      expect(options).toEqual({ acl: "public-read", contentType: "image/png" });
      expect(
        snSupportService.createTicket.mock.calls[0][0].screenshotUrls,
      ).toEqual([`https://s3.example.com/debug-bkt/${key}`]);
    });

    it("drops a file that is not an image and still files the report", async () => {
      const snSupportService = sn();
      const filesService = { directUpload: jest.fn() };
      const { service } = makeForReportIssue(snSupportService, filesService);

      const result = await service.reportIssue(
        reportDto,
        session,
        asUpload(Buffer.from("<!doctype html><script>alert(1)</script>")),
      );

      expect(filesService.directUpload).not.toHaveBeenCalled();
      expect(
        snSupportService.createTicket.mock.calls[0][0].screenshotUrls,
      ).toBeUndefined();
      expect(result.reportId).toBe(7);
    });

    const withDiagnosticsTable = (prisma: Record<string, unknown>) => {
      const create = jest.fn().mockResolvedValue({ id: 1 });
      prisma.reportDiagnostics = { create };
      return create;
    };

    it("stores the screenshot privately when no ticket goes out", async () => {
      const snSupportService = {
        isConfigured: jest.fn().mockReturnValue(false),
        createTicket: jest.fn(),
      };
      const filesService = { directUpload: jest.fn().mockResolvedValue({}) };
      const { service, prisma } = makeForReportIssue(
        snSupportService,
        filesService,
      );
      const create = withDiagnosticsTable(prisma);

      const result = await service.reportIssue(
        reportDto,
        session,
        asUpload(png),
      );

      expect(filesService.directUpload).toHaveBeenCalledTimes(1);
      const [, bucket, key, options] = filesService.directUpload.mock.calls[0];
      expect(bucket).toBe("debug-bkt");
      expect(key).toMatch(/^issue-screenshots\/[\da-f-]{36}\.png$/);
      expect(options).toEqual({ contentType: "image/png" });
      expect(create.mock.calls[0][0].data.data.screenshot).toEqual({
        bucket: "debug-bkt",
        key,
        contentType: "image/png",
        bytes: expect.any(Number),
        public: false,
      });
      expect(result.reportId).toBe(7);
    });

    it("stores a grading dispute's screenshot privately against the report", async () => {
      const snSupportService = sn();
      const filesService = { directUpload: jest.fn().mockResolvedValue({}) };
      const { service, prisma } = makeForReportIssue(
        snSupportService,
        filesService,
      );
      const create = withDiagnosticsTable(prisma);
      const diagnostics = { v: 1 as const, session: { attemptId: 84 } };

      await service.reportIssue(
        {
          ...reportDto,
          issueType: "FALSE_MARKING",
          description: "Question 3 was marked wrong but matches the slides",
          diagnostics,
        },
        session,
        asUpload(png),
      );

      expect(snSupportService.createTicket).not.toHaveBeenCalled();
      expect(filesService.directUpload).toHaveBeenCalledTimes(1);
      const [, , key, options] = filesService.directUpload.mock.calls[0];
      expect(options).not.toHaveProperty("acl");
      expect(create).toHaveBeenCalledTimes(1);
      const { data } = create.mock.calls[0][0];
      expect(data.reportId).toBe(7);
      // The capture is kept alongside the screenshot reference.
      expect(data.data.session).toEqual({ attemptId: 84 });
      expect(data.data.screenshot).toMatchObject({ key, public: false });
    });

    it("stores a junk report's screenshot privately", async () => {
      const snSupportService = sn();
      const filesService = { directUpload: jest.fn().mockResolvedValue({}) };
      const { service, prisma } = makeForReportIssue(
        snSupportService,
        filesService,
      );
      const create = withDiagnosticsTable(prisma);

      await service.reportIssue(
        { ...reportDto, issueType: "BUG", description: "ok" },
        session,
        asUpload(png),
      );

      expect(snSupportService.createTicket).not.toHaveBeenCalled();
      expect(prisma.report.create.mock.calls[0][0].data.closureReason).toBe(
        "junk",
      );
      expect(filesService.directUpload).toHaveBeenCalledTimes(1);
      expect(filesService.directUpload.mock.calls[0][3]).toEqual({
        contentType: "image/png",
      });
      expect(create.mock.calls[0][0].data.data.screenshot).toMatchObject({
        public: false,
      });
    });

    it("uploads a ticketed report's screenshot once and records it", async () => {
      const snSupportService = sn();
      const filesService = { directUpload: jest.fn().mockResolvedValue({}) };
      const { service, prisma } = makeForReportIssue(
        snSupportService,
        filesService,
      );
      const create = withDiagnosticsTable(prisma);

      await service.reportIssue(
        { ...reportDto, issueType: "BUG" },
        session,
        asUpload(png),
      );

      expect(filesService.directUpload).toHaveBeenCalledTimes(1);
      const [, , key, options] = filesService.directUpload.mock.calls[0];
      expect(options).toEqual({ acl: "public-read", contentType: "image/png" });
      expect(
        snSupportService.createTicket.mock.calls[0][0].screenshotUrls,
      ).toEqual([`https://s3.example.com/debug-bkt/${key}`]);
      expect(create.mock.calls[0][0].data.data.screenshot).toMatchObject({
        key,
        public: true,
      });
    });

    it("strips EXIF metadata before publishing", async () => {
      const snSupportService = sn();
      const filesService = { directUpload: jest.fn().mockResolvedValue({}) };
      const { service } = makeForReportIssue(snSupportService, filesService);
      const jpeg = await sharp({
        create: { width: 2, height: 2, channels: 3, background: "#fff" },
      })
        .jpeg()
        .withExif({ IFD0: { Artist: "reporter-device" } })
        .toBuffer();

      await service.reportIssue(reportDto, session, asUpload(jpeg));

      const [file, , key] = filesService.directUpload.mock.calls[0];
      expect(key).toMatch(/\.jpg$/);
      expect((await sharp(file.buffer).metadata()).exif).toBeUndefined();
    });

    it("drops a file whose header sniffs as an image but does not decode", async () => {
      const snSupportService = sn();
      const filesService = { directUpload: jest.fn() };
      const { service } = makeForReportIssue(snSupportService, filesService);

      await service.reportIssue(
        reportDto,
        session,
        asUpload(Buffer.concat([png.subarray(0, 8), Buffer.alloc(32)])),
      );

      expect(filesService.directUpload).not.toHaveBeenCalled();
      expect(
        snSupportService.createTicket.mock.calls[0][0].screenshotUrls,
      ).toBeUndefined();
    });

    it("deletes the published screenshot when the ticket is not created", async () => {
      const snSupportService = {
        isConfigured: jest.fn().mockReturnValue(true),
        createTicket: jest.fn().mockRejectedValue(new Error("SN down")),
      };
      const filesService = {
        directUpload: jest.fn().mockResolvedValue({}),
        deleteFile: jest.fn().mockResolvedValue({}),
      };
      const { service } = makeForReportIssue(snSupportService, filesService);

      const result = await service.reportIssue(
        reportDto,
        session,
        asUpload(png),
      );

      const [, , key] = filesService.directUpload.mock.calls[0];
      expect(filesService.deleteFile).toHaveBeenCalledWith("debug", key);
      expect(result.reportId).toBe(7);
    });

    it("keeps a private copy when the ticket is not created", async () => {
      const snSupportService = {
        isConfigured: jest.fn().mockReturnValue(true),
        createTicket: jest.fn().mockRejectedValue(new Error("SN down")),
      };
      const filesService = {
        directUpload: jest.fn().mockResolvedValue({}),
        deleteFile: jest.fn().mockResolvedValue({}),
      };
      const { service, prisma } = makeForReportIssue(
        snSupportService,
        filesService,
      );
      const create = withDiagnosticsTable(prisma);

      await service.reportIssue(reportDto, session, asUpload(png));

      expect(filesService.directUpload).toHaveBeenCalledTimes(2);
      const [, , publicKey] = filesService.directUpload.mock.calls[0];
      const [, , privateKey, options] = filesService.directUpload.mock.calls[1];
      expect(privateKey).not.toBe(publicKey);
      expect(options).toEqual({ contentType: "image/png" });
      expect(create.mock.calls[0][0].data.data.screenshot).toMatchObject({
        key: privateKey,
        public: false,
      });
    });

    it("files the report without a screenshot when the upload fails", async () => {
      const snSupportService = sn();
      const filesService = {
        directUpload: jest.fn().mockRejectedValue(new Error("storage down")),
      };
      const { service } = makeForReportIssue(snSupportService, filesService);

      const result = await service.reportIssue(
        reportDto,
        session,
        asUpload(png),
      );

      expect(
        snSupportService.createTicket.mock.calls[0][0].screenshotUrls,
      ).toBeUndefined();
      expect(result.reportId).toBe(7);
    });
  });
});

describe("ReportsService.addReportComment emails", () => {
  const commentPrisma = {
    report: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const emailService = {
    sendGenericEmail: jest.fn().mockResolvedValue(true),
  };
  const makeService = () =>
    new ReportsService(
      undefined as never,
      commentPrisma as never,
      undefined as never,
      emailService as never,
      undefined as never,
      undefined as never,
    );
  // SN Support era report: no GitHub issue, so the comment goes out by email.
  const report = {
    id: 42,
    issueNumber: null,
    reporterId: "reporter@example.com",
    status: "OPEN",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GITHUB_DEV_EMAIL = "dev@example.com";
    commentPrisma.report.findUnique.mockResolvedValue({ ...report });
  });

  afterAll(() => {
    delete process.env.GITHUB_DEV_EMAIL;
  });

  it("emails the reporter when an admin comments", async () => {
    await makeService().addReportComment(42, "We found the cause.", {
      userId: "admin@example.com",
      role: "admin",
    } as never);

    expect(emailService.sendGenericEmail).toHaveBeenCalledWith(
      "reporter@example.com",
      "Update on your report #42",
      expect.stringContaining("We found the cause."),
    );
  });

  it("emails the developer address when the reporter comments", async () => {
    await makeService().addReportComment(42, "Still broken for me.", {
      userId: "reporter@example.com",
      role: "learner",
    } as never);

    expect(emailService.sendGenericEmail).toHaveBeenCalledWith(
      "dev@example.com",
      "Update on your report #42",
      expect.stringContaining("Still broken for me."),
    );
  });
});
