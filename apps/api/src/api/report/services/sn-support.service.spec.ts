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
      if (key === "SN_SUPPORT_API_URL") {
        return "https://support.skills.network/";
      }
      if (key === "SN_SUPPORT_API_KEY") return "mark-api-key";
      return undefined;
    });
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

  it("requests critical handling for reports from an IBM email", async () => {
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

    await service.createTicket({
      title: "Mark report",
      description: "Details",
      reporterEmail: "Employee@IBM.COM",
    });

    expect(httpService.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        reporterEmail: "Employee@IBM.COM",
        metadata: expect.objectContaining({
          "mark.requestedPriority": "CRITICAL",
        }),
      }),
      expect.any(Object),
    );
  });

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
