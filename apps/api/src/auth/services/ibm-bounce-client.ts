import { Injectable } from "@nestjs/common";
import axios from "axios";
import { IamTokenManager } from "ibm-cloud-sdk-core";
import { BounceEvent, parseBounce } from "./email-bounce-source";

@Injectable()
export class IbmBounceClient {
  private tokenManager?: IamTokenManager;

  async page(
    source: string,
    start: Date,
    end: Date,
    offset: number,
  ): Promise<{ events: BounceEvent[]; total: number }> {
    const apiKey = process.env.EMAIL_BOUNCE_API_KEY;
    const endpoint = process.env.EMAIL_BOUNCE_API_URL;
    if (!apiKey || !endpoint)
      throw new Error("Bounce API credentials or endpoint missing");
    const url = new URL(endpoint);
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".event-notifications.cloud.ibm.com") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error("Invalid IBM bounce API endpoint");
    }
    this.tokenManager ??= new IamTokenManager({ apikey: apiKey });
    const token: unknown = await this.tokenManager.getToken();
    if (typeof token !== "string" || !token)
      throw new Error("IBM IAM did not return a token");
    const [instance, configuration] = source.split("/");
    const response = await axios.get<unknown>(
      `${endpoint.replace(/\/$/, "")}/v1/instances/${encodeURIComponent(instance)}/metrics/bounce`,
      {
        timeout: 20_000,
        maxRedirects: 0,
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "Mark-Email-Bounce-Poller/1.0",
          Accept: "application/json",
        },
        params: {
          smtp_config_id: configuration,
          gte: start.toISOString().replace(/\.\d{3}Z$/, "Z"),
          lte: end.toISOString().replace(/\.\d{3}Z$/, "Z"),
          limit: 100,
          offset,
        },
      },
    );
    const data = response.data as {
      metrics?: unknown[];
      total_count?: number;
    } | null;
    if (
      !data ||
      !Array.isArray(data.metrics) ||
      !Number.isSafeInteger(data.total_count) ||
      data.total_count < 0
    ) {
      throw new Error("Invalid IBM bounce page");
    }
    const events = data.metrics.map((row) => parseBounce(row, source));
    if (
      events.length > 100 ||
      events.some((event) => event.occurredAt < start || event.occurredAt > end)
    ) {
      throw new Error("IBM bounce page outside requested bounds");
    }
    return { events, total: data.total_count };
  }
}
