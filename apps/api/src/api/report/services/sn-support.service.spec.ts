import { HttpService } from "@nestjs/axios";
import {
  BadRequestException,
  InternalServerErrorException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { of } from "rxjs";
import { SnSupportService } from "./sn-support.service";

describe("SnSupportService", () => {
  const httpService = {
    post: jest.fn(),
  };
  const configService = {
    get: jest.fn(),
  };
  const service = new SnSupportService(
    httpService as unknown as HttpService,
    configService as unknown as ConfigService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    configService.get.mockImplementation((key: string) => {
      if (key === "SN_SUPPORT_URL") {
        return "https://support.skills.network/";
      }
      if (key === "SN_SUPPORT_TOKEN") return "mark-api-key";
      return undefined;
    });
  });

  const mockTicketResponse = () => {
    httpService.post.mockReturnValue(
      of({
        data: {
          ticketKey: "SUPPORT-104",
          reportKey: "SUPPORT-104-1",
          status: "open" as const,
          createdAt: "2026-08-12T18:00:00.000Z",
        },
      }),
    );
  };

  it("reports configured only when both URL and token are set", () => {
    expect(service.isConfigured()).toBe(true);
    configService.get.mockReturnValue(undefined);
    expect(service.isConfigured()).toBe(false);
  });

  it("creates a ticket through the product-scoped v2 API", async () => {
    const ticket = {
      title: "Mark report",
      description: "A learner cannot submit an assignment",
      reporterEmail: "learner@example.com",
      issueType: "technical",
      portalName: "Coursera",
      courseTitle: "Introduction to AI",
      toolName: "Mark",
    };
    const response = {
      ticketKey: "SUPPORT-100",
      reportKey: "SUPPORT-100-1",
      status: "open" as const,
      createdAt: "2026-08-12T18:00:00.000Z",
    };
    httpService.post.mockReturnValue(of({ data: response }));

    await expect(service.createTicket(ticket)).resolves.toEqual(response);

    expect(httpService.post).toHaveBeenCalledWith(
      "https://support.skills.network/api/external/v2/tickets",
      {
        title: "Mark report",
        description: "A learner cannot submit an assignment",
        reporterEmail: "learner@example.com",
        source: "Mark",
        reporterOrigin: "Coursera",
        pageUrl: undefined,
        browser: undefined,
        chatHistoryUrl: undefined,
        metadata: {
          portalName: "Coursera",
          toolName: "Mark",
          courseTitle: "Introduction to AI",
          "mark.issueType": "technical",
          "mark.requestedPriority": "MEDIUM",
        },
      },
      {
        headers: { Authorization: "Bearer mark-api-key" },
        timeout: 10_000,
      },
    );
  });

  it.each([
    ["info", "LOW"],
    ["warning", "MEDIUM"],
    ["error", "HIGH"],
    ["critical", "CRITICAL"],
    [undefined, "MEDIUM"],
    ["not-a-severity", "MEDIUM"],
  ])(
    "maps reporter severity %s to requested priority %s",
    async (severity, expectedPriority) => {
      httpService.post.mockReturnValue(
        of({
          data: {
            ticketKey: "SUPPORT-101",
            reportKey: "SUPPORT-101-1",
            status: "open",
            createdAt: "2026-08-12T18:00:00.000Z",
          },
        }),
      );

      // An IBM reporter address must not influence the priority — only the
      // severity the reporter picked does.
      await service.createTicket({
        title: "Mark report",
        description: "Details",
        reporterEmail: "Employee@IBM.COM",
        severity,
      });

      expect(httpService.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          metadata: expect.objectContaining({
            "mark.requestedPriority": expectedPriority,
          }),
        }),
        expect.any(Object),
      );
    },
  );

  it("passes the screenshot as metadata.imageUrl and drops non-HTTP values", async () => {
    httpService.post.mockReturnValue(
      of({
        data: {
          ticketKey: "SUPPORT-102",
          reportKey: "SUPPORT-102-1",
          status: "open",
          createdAt: "2026-08-12T18:00:00.000Z",
        },
      }),
    );

    await service.createTicket({
      title: "Mark report",
      description: "Details",
      reporterEmail: "learner@example.com",
      screenshotUrl: "https://cos.example.com/bucket/shot.png",
    });
    expect(httpService.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        metadata: expect.objectContaining({
          imageUrl: "https://cos.example.com/bucket/shot.png",
        }),
      }),
      expect.any(Object),
    );

    httpService.post.mockClear();
    httpService.post.mockReturnValue(
      of({
        data: {
          ticketKey: "SUPPORT-103",
          reportKey: "SUPPORT-103-1",
          status: "open",
          createdAt: "2026-08-12T18:00:00.000Z",
        },
      }),
    );
    await service.createTicket({
      title: "Mark report",
      description: "Details",
      reporterEmail: "learner@example.com",
      screenshotUrl: "not-a-url",
    });
    const [, sentBody] = httpService.post.mock.calls[0] as [
      string,
      { metadata: Record<string, string> },
    ];
    expect(sentBody.metadata.imageUrl).toBeUndefined();
  });

  // The v2 create contract has no portalUrl field and rejects unknown
  // top-level keys, so the portal URL has to travel as custom metadata.
  it("sends the portal URL as custom metadata", async () => {
    mockTicketResponse();

    await service.createTicket({
      title: "Mark report",
      description: "Details",
      reporterEmail: "learner@example.com",
      portalName: "Cognitive Class",
      portalUrl: "https://cognitiveclass.ai",
    });

    const [, sentBody] = httpService.post.mock.calls[0] as [
      string,
      { reporterOrigin?: string; metadata: Record<string, string> },
    ];
    expect(sentBody.reporterOrigin).toBe("Cognitive Class");
    expect(sentBody.metadata).toMatchObject({
      portalName: "Cognitive Class",
      portalUrl: "https://cognitiveclass.ai",
    });
  });

  // SN Support's base mapper (used for the unregistered source "Mark") drops
  // pageUrl and browser before they reach the Issue row; the metadata copies
  // are what actually survive.
  it("duplicates the page URL and browser into metadata", async () => {
    mockTicketResponse();

    await service.createTicket({
      title: "Mark report",
      description: "Details",
      reporterEmail: "learner@example.com",
      pageUrl: "https://mark.skills.network/learner/1/questions",
      browser: "Chrome 141 on macOS",
    });

    const [, sentBody] = httpService.post.mock.calls[0] as [
      string,
      { pageUrl?: string; browser?: string; metadata: Record<string, string> },
    ];
    expect(sentBody.pageUrl).toBe(
      "https://mark.skills.network/learner/1/questions",
    );
    expect(sentBody.metadata).toMatchObject({
      "mark.pageUrl": "https://mark.skills.network/learner/1/questions",
      "mark.browser": "Chrome 141 on macOS",
    });
  });

  // A ticket is worth more than any one of its context URLs, so a malformed
  // one is dropped instead of failing the report.
  it.each(["portalUrl", "pageUrl", "chatHistoryUrl"] as const)(
    "drops a malformed %s instead of rejecting the ticket",
    async (field) => {
      mockTicketResponse();

      await expect(
        service.createTicket({
          title: "Mark report",
          description: "Details",
          reporterEmail: "learner@example.com",
          [field]: "not-a-url",
        }),
      ).resolves.toMatchObject({ ticketKey: "SUPPORT-104" });

      const [, sentBody] = httpService.post.mock.calls[0] as [
        string,
        Record<string, unknown> & { metadata: Record<string, string> },
      ];
      expect(sentBody[field]).toBeUndefined();
      expect(sentBody.metadata.portalUrl).toBeUndefined();
    },
  );

  it("rejects a ticket without the reporter email required by v2", async () => {
    await expect(
      service.createTicket({ title: "Mark report", description: "Details" }),
    ).rejects.toThrow(BadRequestException);
    expect(httpService.post).not.toHaveBeenCalled();
  });

  it("fails before sending when the integration is not configured", async () => {
    configService.get.mockReturnValue(undefined);

    await expect(
      service.createTicket({ title: "Mark report", description: "Details" }),
    ).rejects.toThrow(InternalServerErrorException);
    expect(httpService.post).not.toHaveBeenCalled();
  });
});
