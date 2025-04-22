import * as http from "node:http";
import * as https from "node:https";
import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from "@nestjs/common";
import { AxiosRequestConfig } from "@nestjs/terminus/dist/health-indicator/http/axios.interfaces";
import axios, { AxiosError, Method } from "axios";
import { Request, Response } from "express";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { UserSessionRequest } from "../auth/interfaces/user.session.interface";
import { MessagingService } from "../messaging/messaging.service";
import { DownstreamService } from "./api.controller";

@Injectable()
export class ApiService {
  private logger;
  constructor(
    private readonly messagingService: MessagingService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: ApiService.name });
  }

  rootV1(): Record<string, string | number> {
    this.logger.info("showing api version information");
    void this.messagingService.publishService("api", {});
    return { version: 1 };
  }

  /**
   * Computes the forwarding endpoint URL and additional headers based on the downstream service.
   */
  public getForwardingDetails(
    forwardingService: DownstreamService,
    request: UserSessionRequest,
  ): { endpoint: string; extraHeaders: Record<string, any> } {
    let endpoint: string;
    let extraHeaders: Record<string, any> = {};
    switch (forwardingService) {
      case DownstreamService.MARK_API: {
        endpoint = `${process.env.MARK_API_ENDPOINT ?? ""}${
          request.originalUrl
        }`;
        extraHeaders = {
          "user-session": JSON.stringify(request.user),
          "Cache-Control": "no-cache",
        };
        break;
      }
      case DownstreamService.LTI_CREDENTIAL_MANAGER: {
        const servicePath = request.originalUrl.split("/").slice(3).join("/");
        endpoint = `${
          process.env.LTI_CREDENTIAL_MANAGER_ENDPOINT ?? ""
        }/${servicePath}`;
        const username = process.env.LTI_CREDENTIAL_MANAGER_USERNAME ?? "";
        const password = process.env.LTI_CREDENTIAL_MANAGER_PASSWORD ?? "";
        const base64Credentials = Buffer.from(
          `${username}:${password}`,
        ).toString("base64");
        extraHeaders = {
          Authorization: `Basic ${base64Credentials}`,
        };
        break;
      }
      default: {
        throw new BadRequestException();
      }
    }
    return { endpoint, extraHeaders };
  }

  async forwardRequestToDownstreamService(
    forwardingService: DownstreamService,
    request: UserSessionRequest,
  ): Promise<{ data: string; status: number }> {
    try {
      if (!request.originalUrl) {
        throw new BadRequestException();
      }
      const { endpoint, extraHeaders } = this.getForwardingDetails(
        forwardingService,
        request,
      );
      this.logger.info(`Making request to ${endpoint}`);

      const originalHeaders = { ...request.headers };
      // Remove headers that may cause issues.
      delete originalHeaders["host"];
      delete originalHeaders["content-length"];

      const config: AxiosRequestConfig = {
        method: request.method.toLowerCase() as Method,
        url: endpoint,
        data: request.body as Record<string, any>,
        headers: {
          ...originalHeaders,
          ...extraHeaders,
        },
      };

      this.logger.info("Forwarding request: ", config);
      const response = await axios.request(config);
      return { data: response.data as string, status: response.status };
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.isAxiosError && axiosError.response) {
        this.logger.error(axiosError.response.status);
        this.logger.error(axiosError.response.data);
        throw new HttpException(
          axiosError.response?.data ?? "",
          axiosError.response.status,
        );
      }
      this.logger.error(error);
      throw new InternalServerErrorException();
    }
  }

  /**
   * Forwards a client request using Node's native http/https modules.
   * This is used for streaming (SSE) responses.
   *
   * @param clientRequest - The incoming Express request.
   * @param clientResponse - The outgoing Express response.
   * @param url - The target URL to forward to.
   * @param headers - Additional headers to include.
   */
  async forwardRequestUsingHttp(
    clientRequest: Request,
    clientResponse: Response,
    url: string,
    headers: Record<string, any> = {},
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const isHTTPS = url.startsWith("https");
      // Check for SSE in the Accept header.
      const isSSE =
        clientRequest.headers.accept?.includes("text/event-stream") ?? false;

      // Define agents for keepAlive vs. no-keepAlive (for streaming).
      const httpAgent = new http.Agent({ keepAlive: true });
      const httpAgentNoKeepAlive = new http.Agent({ keepAlive: false });
      const httpsAgent = new https.Agent({ keepAlive: true });
      const httpsAgentNoKeepAlive = new https.Agent({ keepAlive: false });

      const httpModule = isHTTPS ? https : http;
      const agent = isHTTPS
        ? // eslint-disable-next-line unicorn/no-nested-ternary
          isSSE
          ? httpsAgentNoKeepAlive
          : httpsAgent
        : // eslint-disable-next-line unicorn/no-nested-ternary
          isSSE
          ? httpAgentNoKeepAlive
          : httpAgent;

      const outgoingHeaders = {
        ...clientRequest.headers,
        ...headers,
      };
      delete outgoingHeaders.host;
      delete outgoingHeaders["content-length"];

      this.logger.info(`Forwarding ${clientRequest.method} request to ${url}`);

      const proxyRequest = httpModule.request(
        url,
        {
          method: clientRequest.method,
          headers: outgoingHeaders,
          agent,
        },
        (proxyResponse) => {
          const isStreaming =
            proxyResponse.headers["content-type"]?.includes(
              "text/event-stream",
            );

          clientResponse.writeHead(proxyResponse.statusCode || 500, {
            ...proxyResponse.headers,
            ...(isStreaming ? { connection: "close" } : {}),
          });

          proxyResponse.pipe(clientResponse);

          if (isStreaming) {
            clientResponse.on("close", () => {
              proxyResponse.destroy();
              resolve();
            });
            proxyResponse.on("end", resolve);
          } else {
            proxyResponse.on("end", resolve);
            clientResponse.on("close", () => {
              if (!proxyResponse.destroyed) {
                proxyResponse.destroy();
              }
            });
          }
        },
      );

      clientResponse.on("close", () => {
        if (!proxyRequest.destroyed) {
          proxyRequest.destroy();
        }
      });

      proxyRequest.on("error", (error) => {
        if (!clientResponse.headersSent) {
          clientResponse.status(500).end();
        }
        reject(error);
      });

      if (clientRequest.body) {
        const body: string | Buffer =
          typeof clientRequest.body === "object" &&
          !Buffer.isBuffer(clientRequest.body)
            ? JSON.stringify(clientRequest.body)
            : (clientRequest.body as string | Buffer);
        proxyRequest.write(body);
      }
      proxyRequest.end();
    });
  }
}
