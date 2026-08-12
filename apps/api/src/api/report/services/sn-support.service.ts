import { HttpService } from "@nestjs/axios";
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";

export interface SnSupportTicket {
  title: string;
  description: string;
  reporterEmail?: string;
  issueType?: string;
  pageUrl?: string;
  portalName?: string;
  courseTitle?: string;
  toolName?: string;
  browser?: string;
  chatHistoryUrl?: string;
}

interface SnSupportTicketResponse {
  ticketKey: string;
  reportKey: string;
  status: "open" | "in_progress" | "resolved" | "closed";
  createdAt: string;
}

function normalizeHttpUrl(field: string, value?: string): string | undefined {
  const normalizedValue = value?.trim();
  if (!normalizedValue) return;

  let isHttpUrl = false;
  try {
    const protocol = new URL(normalizedValue).protocol;
    isHttpUrl = protocol === "http:" || protocol === "https:";
  } catch {
    isHttpUrl = false;
  }

  if (!isHttpUrl) {
    throw new BadRequestException(
      `SN Support ${field} must be an HTTP or HTTPS URL`,
    );
  }

  return normalizedValue;
}

@Injectable()
export class SnSupportService {
  private readonly logger = new Logger(SnSupportService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async createTicket(
    ticket: SnSupportTicket,
  ): Promise<SnSupportTicketResponse> {
    const baseUrl = this.configService
      .get<string>("SN_SUPPORT_API_URL")
      ?.trim()
      .replace(/\/+$/, "");
    const apiKey = this.configService.get<string>("SN_SUPPORT_API_KEY")?.trim();

    if (!baseUrl || !apiKey) {
      throw new InternalServerErrorException(
        "SN Support integration is not configured",
      );
    }

    const reporterEmail = ticket.reporterEmail?.trim();
    if (!reporterEmail) {
      throw new BadRequestException(
        "Reporter email is required to create an SN Support ticket",
      );
    }

    if (ticket.title.length > 500) {
      throw new BadRequestException("SN Support ticket title is too long");
    }
    if (ticket.description.length > 10_000) {
      throw new BadRequestException(
        "SN Support ticket description is too long",
      );
    }

    const reporterOrigin = ticket.portalName?.trim();
    if (reporterOrigin && reporterOrigin.length > 200) {
      throw new BadRequestException("SN Support reporter origin is too long");
    }

    const isIbmReporter = /^[^\s@]+@ibm\.com$/i.test(reporterEmail);
    const metadata: Record<string, string> = {
      "mark.requestedPriority": isIbmReporter ? "CRITICAL" : "MEDIUM",
    };

    const addMetadata = (key: string, value?: string) => {
      const normalizedValue = value?.trim();
      if (!normalizedValue) return;
      if (normalizedValue.length > 500) {
        throw new BadRequestException(
          `SN Support metadata value is too long: ${key}`,
        );
      }
      metadata[key] = normalizedValue;
    };

    addMetadata("portalName", ticket.portalName);
    addMetadata("toolName", ticket.toolName);
    addMetadata("courseTitle", ticket.courseTitle);
    addMetadata("mark.issueType", ticket.issueType);

    const supportTicket = {
      title: ticket.title,
      description: ticket.description,
      reporterEmail,
      source: "Mark",
      reporterOrigin,
      pageUrl: normalizeHttpUrl("page URL", ticket.pageUrl),
      browser: ticket.browser,
      chatHistoryUrl: normalizeHttpUrl(
        "chat history URL",
        ticket.chatHistoryUrl,
      ),
      metadata,
    };

    const response = await firstValueFrom(
      this.httpService.post<SnSupportTicketResponse>(
        `${baseUrl}/api/external/v2/tickets`,
        supportTicket,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          timeout: 10_000,
        },
      ),
    );

    this.logger.log(`Created SN Support ticket ${response.data.ticketKey}`);
    return response.data;
  }
}
