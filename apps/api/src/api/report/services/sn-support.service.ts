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
  severity?: string;
  issueType?: string;
  pageUrl?: string;
  portalName?: string;
  portalUrl?: string;
  courseTitle?: string;
  toolName?: string;
  browser?: string;
  chatHistoryUrl?: string;
  screenshotUrl?: string;
}

interface SnSupportTicketResponse {
  ticketKey: string;
  reportKey: string;
  status: "open" | "in_progress" | "resolved" | "closed";
  createdAt: string;
}

// requestedPriority mirrors the severity the reporter picked; the value is
// frontend-supplied, so anything outside the known set falls back to MEDIUM.
const REQUESTED_PRIORITY_BY_SEVERITY: Record<string, string> = {
  info: "LOW",
  warning: "MEDIUM",
  error: "HIGH",
  critical: "CRITICAL",
};

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

  /**
   * Whether the SN Support endpoint is reachable. The credential is not part
   * of this check: the API key decides which product a ticket lands in, so it
   * is chosen per report by SupportRoutingService and passed to createTicket.
   */
  isConfigured(): boolean {
    return Boolean(this.configService.get<string>("SN_SUPPORT_URL")?.trim());
  }

  /**
   * Every URL on a ticket is optional context, so a malformed one is dropped
   * with a warning rather than throwing and losing the whole report.
   */
  private optionalHttpUrl(field: string, value?: string): string | undefined {
    try {
      return normalizeHttpUrl(field, value);
    } catch {
      this.logger.warn(`Dropping non-HTTP ${field} from SN ticket`);
      return;
    }
  }

  /**
   * @param apiKeyOverride the product-scoped key this ticket should be filed
   * with; falls back to SN_SUPPORT_TOKEN for local dev and pre-routing deploys.
   */
  async createTicket(
    ticket: SnSupportTicket,
    apiKeyOverride?: string,
  ): Promise<SnSupportTicketResponse> {
    const baseUrl = this.configService
      .get<string>("SN_SUPPORT_URL")
      ?.trim()
      .replace(/\/+$/, "");
    const apiKey =
      apiKeyOverride?.trim() ||
      this.configService.get<string>("SN_SUPPORT_TOKEN")?.trim();

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

    const metadata: Record<string, string> = {
      "mark.requestedPriority":
        REQUESTED_PRIORITY_BY_SEVERITY[
          ticket.severity?.trim().toLowerCase() ?? ""
        ] ?? "MEDIUM",
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

    const pageUrl = this.optionalHttpUrl("page URL", ticket.pageUrl);

    addMetadata("portalName", ticket.portalName);
    addMetadata("toolName", ticket.toolName);
    addMetadata("courseTitle", ticket.courseTitle);
    addMetadata("mark.issueType", ticket.issueType);
    // SN Support has an Issue.portalUrl column, but the v2 contract cannot set
    // it — unknown top-level keys are rejected outright — so the portal URL
    // rides as custom metadata, which is stored and displayed verbatim.
    addMetadata(
      "portalUrl",
      this.optionalHttpUrl("portal URL", ticket.portalUrl),
    );
    // `source: "Mark"` is not one of SN Support's registered intake mappers, so
    // its base mapper drops pageUrl, browser, chatHistoryUrl, courseTitle and
    // toolName before they reach the Issue row. Custom metadata survives that
    // path, so those values are duplicated here until SN Support registers a
    // "Mark" mapper, after which this duplication can go.
    addMetadata("mark.pageUrl", pageUrl);
    addMetadata("mark.browser", ticket.browser);
    // SN Support surfaces an opening screenshot from metadata.imageUrl.
    addMetadata(
      "imageUrl",
      this.optionalHttpUrl("screenshot URL", ticket.screenshotUrl),
    );

    const supportTicket = {
      title: ticket.title,
      description: ticket.description,
      reporterEmail,
      source: "Mark",
      reporterOrigin,
      pageUrl,
      browser: ticket.browser,
      chatHistoryUrl: this.optionalHttpUrl(
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
