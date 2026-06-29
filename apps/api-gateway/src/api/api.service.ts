/* eslint-disable unicorn/no-nested-ternary */
import * as http from "node:http";
import * as https from "node:https";
import type {
  IncomingHttpHeaders,
  OutgoingHttpHeader,
  OutgoingHttpHeaders,
  RequestOptions,
} from "node:http";
import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from "@nestjs/common";
import { AxiosRequestConfig } from "@nestjs/terminus/dist/health-indicator/http/axios.interfaces";
import axios, { AxiosError, Method, type RawAxiosRequestHeaders } from "axios";
import { Request, Response } from "express";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { UserSessionRequest } from "../auth/interfaces/user.session.interface";
import { MessagingService } from "../messaging/messaging.service";
import { DownstreamService } from "./api.controller";
import { sanitizeForLog } from "../logger/sanitize";

// Headers whose values are secrets/PII and must never be logged. Compared
// case-insensitively. Hoisted to module scope so it isn't rebuilt per request.
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "user-session",
  "x-admin-token",
  "admin-token",
]);

@Injectable()
export class ApiService {
  private readonly logger: Logger;
  constructor(
    private readonly messagingService: MessagingService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: ApiService.name });
  }

  /**
   * Helper method to safely send error responses
   * Works with both Express Response and MockResponse objects
   */
  private sendErrorResponse(
    response:
      | Response
      | (NodeJS.WritableStream & {
          headersSent?: boolean;
          writableEnded?: boolean;
          writeHead: (
            statusCode: number,
            headers?: Record<string, string>,
          ) => void;
          end: (data?: string | Buffer) => void;
        }),
    statusCode: number,
    errorMessage: string,
    isJson = true,
  ): void {
    try {
      if (!response.headersSent) {
        if (isJson) {
          response.writeHead(statusCode, {
            "Content-Type": "application/json",
          });
          response.end(JSON.stringify({ error: errorMessage }));
        } else {
          response.writeHead(statusCode);
          response.end();
        }
      }
    } catch (error) {
      this.logger.error(`Failed to send error response: ${String(error)}`);
      try {
        if (!response.writableEnded) {
          response.end();
        }
      } catch (finalError) {
        this.logger.error(`Failed to end response: ${String(finalError)}`);
      }
    }
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
  ): { endpoint: string; extraHeaders: RawAxiosRequestHeaders } {
    let endpoint: string;
    let extraHeaders: RawAxiosRequestHeaders = {};
    switch (forwardingService) {
      case DownstreamService.MARK_API: {
        endpoint = `${process.env.MARK_API_ENDPOINT ?? ""}${
          request.originalUrl
        }`;
        this.assertConfiguredOrigin(endpoint, process.env.MARK_API_ENDPOINT);

        if (!request.user) {
          throw new UnauthorizedException("Missing or invalid user session");
        }

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
        this.assertConfiguredOrigin(
          endpoint,
          process.env.LTI_CREDENTIAL_MANAGER_ENDPOINT,
        );
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

  /**
   * Ensure a computed forwarding endpoint still resolves to the configured
   * downstream origin. The downstream host is fixed by configuration; a crafted
   * request target must never be able to move the forward to another host.
   */
  private assertConfiguredOrigin(
    endpoint: string,
    base: string | undefined,
  ): void {
    if (!base) {
      throw new InternalServerErrorException(
        "Downstream service endpoint is not configured",
      );
    }
    let target: URL;
    let configured: URL;
    try {
      configured = new URL(base);
      target = new URL(endpoint);
    } catch {
      throw new BadRequestException("Invalid forwarding target");
    }
    const protocolAllowed =
      target.protocol === "http:" || target.protocol === "https:";
    if (!protocolAllowed || target.origin !== configured.origin) {
      this.logger.warn("Blocked forwarding to an unexpected origin", {
        configured_origin: configured.origin,
        target_origin: target.origin,
      });
      throw new BadRequestException("Invalid forwarding target");
    }
  }

  private normalizeOutgoingHeaderValue(
    value: unknown,
  ): OutgoingHttpHeader | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (Array.isArray(value)) {
      return value
        .filter(
          (item): item is Exclude<typeof item, null | undefined> =>
            item !== undefined && item !== null,
        )
        .map((item) => (typeof item === "string" ? item : String(item)));
    }

    if (typeof value === "string" || typeof value === "number") {
      return value;
    }

    return String(value);
  }

  private normalizeOutgoingHeaders(
    ...headerGroups: Array<
      IncomingHttpHeaders | RawAxiosRequestHeaders | undefined
    >
  ): OutgoingHttpHeaders {
    const normalizedHeaders: OutgoingHttpHeaders = {};

    for (const headerGroup of headerGroups) {
      if (!headerGroup) {
        continue;
      }

      for (const [key, value] of Object.entries(headerGroup)) {
        const normalizedValue = this.normalizeOutgoingHeaderValue(value);

        if (normalizedValue !== undefined) {
          normalizedHeaders[key] = normalizedValue;
        }
      }
    }

    return normalizedHeaders;
  }
  /**
   * Forward SSE requests specifically
   */
  async forwardSSERequest(
    clientRequest: Request,
    clientResponse: Response,
    url: string,
    headers: RawAxiosRequestHeaders = {},
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const isHTTPS = url.startsWith("https");
      const httpModule = isHTTPS ? https : http;

      const parsedUrl = new URL(url);

      const outgoingHeaders = this.normalizeOutgoingHeaders(
        clientRequest.headers,
        headers,
        {
          host: parsedUrl.hostname,
          accept: "text/event-stream",
        },
      );

      delete outgoingHeaders["content-length"];

      this.logger.info(`Forwarding SSE request to ${url}`);

      const requestOptions: RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port ? Number(parsedUrl.port) : isHTTPS ? 443 : 80,
        path: parsedUrl.pathname + parsedUrl.search,
        method: "GET",
        headers: outgoingHeaders,
        timeout: 600_000,
      };

      const proxyRequest = httpModule.request(
        requestOptions,
        (proxyResponse) => {
          this.logger.info(
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            `SSE response received: ${proxyResponse.statusCode}`,
          );

          clientResponse.writeHead(proxyResponse.statusCode || 200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
            ...proxyResponse.headers,
          });

          proxyResponse.pipe(clientResponse);

          clientResponse.on("close", () => {
            this.logger.info("Client disconnected from SSE stream");
            proxyResponse.destroy();
            resolve();
          });

          proxyResponse.on("end", () => {
            this.logger.info("SSE stream ended");
            resolve();
          });

          proxyResponse.on("error", (error) => {
            this.logger.error("SSE proxy response error:", error);
            if (!clientResponse.writableEnded) {
              clientResponse.end();
            }
            reject(error);
          });
        },
      );

      proxyRequest.on("error", (error) => {
        this.logger.error("SSE proxy request error:", error);
        if (!clientResponse.headersSent) {
          this.sendErrorResponse(
            clientResponse,
            500,
            "SSE proxy request failed",
          );
        }
        reject(error);
      });

      proxyRequest.on("timeout", () => {
        this.logger.error("SSE proxy request timeout");
        proxyRequest.destroy();
        if (!clientResponse.writableEnded) {
          clientResponse.end();
        }
        reject(new Error("SSE proxy request timeout"));
      });

      proxyRequest.end();
    });
  }
  /**
   * Check if request is multipart/form-data
   */
  private isMultipartRequest(request: UserSessionRequest): boolean {
    const contentType = request.headers["content-type"] || "";
    return contentType.toLowerCase().includes("multipart/form-data");
  }

  /**
   * Check if request is for binary file content (images, videos, etc.)
   */
  private isBinaryFileRequest(request: UserSessionRequest): boolean {
    const url = request.originalUrl || "";
    const path = request.path || "";

    if (url.includes("/files/proxy") || path.includes("/files/proxy")) {
      return true;
    }

    if (url.includes("/files/download") || path.includes("/files/download")) {
      return true;
    }

    const accept = request.headers.accept || "";
    if (
      accept.includes("image/") ||
      accept.includes("video/") ||
      accept.includes("audio/") ||
      accept.includes("application/octet-stream")
    ) {
      return true;
    }

    return false;
  }

  /**
   * Enhanced request forwarding that handles regular, multipart, and binary requests
   */
  async forwardRequestToDownstreamService(
    forwardingService: DownstreamService,
    request: UserSessionRequest,
  ): Promise<{ data: string; status: number }> {
    let endpoint: string | undefined;
    try {
      if (!request.originalUrl) {
        throw new BadRequestException();
      }

      const forwardingDetails = this.getForwardingDetails(
        forwardingService,
        request,
      );
      endpoint = forwardingDetails.endpoint;
      const extraHeaders = forwardingDetails.extraHeaders;

      const isMultipart = this.isMultipartRequest(request);
      const isBinaryFile = this.isBinaryFileRequest(request);

      if (isMultipart || isBinaryFile) {
        this.logger.info(
          `Using HTTP forwarding for ${
            isMultipart ? "multipart" : "binary file"
          } request: ${endpoint}`,
        );

        return new Promise((resolve, reject) => {
          interface MockResponse {
            statusCode: number;
            headers: Record<string, unknown>;
            data: Buffer;
            headersSent: boolean;
            writableEnded: boolean;
            writeHead(
              this: MockResponse,
              statusCode: number,
              headers: Record<string, unknown>,
            ): void;
            write(this: MockResponse, chunk: string | Buffer): void;
            end(this: MockResponse, chunk?: string | Buffer): void;
            status(this: MockResponse, code: number): MockResponse;
            json(this: MockResponse, body: unknown): void;
            on(
              event: string,
              listener: (...arguments_: unknown[]) => void,
            ): void;
            once?(
              event: string,
              listener: (...arguments_: unknown[]) => void,
            ): void;
            pipe<T>(this: MockResponse, destination: T): T;
          }

          const mockResponse: MockResponse = {
            statusCode: 200,
            headers: {},
            data: Buffer.alloc(0),
            headersSent: false,
            writableEnded: false,
            writeHead(
              this: MockResponse,
              statusCode: number,
              headers: Record<string, unknown>,
            ) {
              this.statusCode = statusCode;
              this.headers = headers;
              this.headersSent = true;
            },
            write(this: MockResponse, chunk: string | Buffer) {
              const bufferChunk = Buffer.isBuffer(chunk)
                ? chunk
                : Buffer.from(chunk);
              this.data = Buffer.concat([this.data, bufferChunk]);
            },
            end(this: MockResponse, chunk?: string | Buffer) {
              if (chunk) {
                const bufferChunk = Buffer.isBuffer(chunk)
                  ? chunk
                  : Buffer.from(chunk);
                this.data = Buffer.concat([this.data, bufferChunk]);
              }

              this.writableEnded = true;

              const dataToReturn = isBinaryFile
                ? this.data.toString("base64")
                : this.data.toString("utf8");

              resolve({
                data: dataToReturn,
                status: this.statusCode,
              });
            },
            status(this: MockResponse, code: number): MockResponse {
              this.statusCode = code;
              return this;
            },
            json(this: MockResponse, body: unknown): void {
              this.writeHead(this.statusCode, {
                "Content-Type": "application/json",
              });
              this.end(JSON.stringify(body));
            },
            on(
              _event: string,
              _listener: (...arguments_: unknown[]) => void,
            ): void {
              void _event;
              void _listener;
              // no-op for mock response
            },
            once(
              _event: string,
              _listener: (...arguments_: unknown[]) => void,
            ): void {
              void _event;
              void _listener;
              // no-op for mock response
            },

            pipe<T>(this: MockResponse, _destination: T): T {
              void _destination;
              return this as unknown as T;
            },
          };

          this.forwardRequestUsingHttp(
            request as Request,
            mockResponse as unknown as Response,
            forwardingDetails.endpoint,
            extraHeaders,
          )
            .then(() => {
              this.logger.info(
                `Forwarded ${
                  isBinaryFile ? "binary file" : "multipart"
                } request successfully`,
              );
              resolve({
                data: mockResponse.data.toString("utf8"),
                status: mockResponse.statusCode,
              });
            })
            .catch(reject);
        });
      }

      this.logger.info(`Making axios request to ${endpoint}`);

      const originalHeaders = { ...request.headers };

      delete originalHeaders["host"];
      delete originalHeaders["content-length"];

      const config: AxiosRequestConfig = {
        method: request.method.toLowerCase() as Method,
        url: endpoint,
        data: request.body as Record<string, unknown>,
        headers: {
          ...originalHeaders,
          ...extraHeaders,
        },
      };

      const safeHeaders = Object.fromEntries(
        Object.entries((config.headers ?? {}) as Record<string, unknown>).map(
          ([key, value]) =>
            SENSITIVE_HEADERS.has(key.toLowerCase())
              ? [key, "[redacted]"]
              : [key, sanitizeForLog(value)],
        ),
      );
      this.logger.debug("Forwarding request", {
        method: config.method,
        url: config.url,
        headers: safeHeaders,
      });
      const response = await axios.request(config);
      return { data: response.data as string, status: response.status };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      const axiosError = error as AxiosError;
      const endpointForLog = endpoint ?? "<unknown>";
      const safeMethod = sanitizeForLog(request.method);
      const safeEndpoint = sanitizeForLog(endpointForLog);
      const requestId = sanitizeForLog(
        request.get("akamai-grn") ?? request.get("x-request-id"),
      );
      if (axiosError.isAxiosError && axiosError.response) {
        this.logger.error(
          `forward_failed downstream=${axiosError.response.status} ${safeMethod} ${safeEndpoint}`,
          {
            downstream_status: axiosError.response.status,
            downstream_data: sanitizeForLog(axiosError.response.data),
            downstream_url: safeEndpoint,
            downstream_method: safeMethod,
            axios_code: sanitizeForLog(axiosError.code),
            request_id: requestId,
          },
        );
        throw new HttpException(
          axiosError.response?.data ?? "",
          axiosError.response.status,
        );
      }
      this.logger.error(
        `forward_failed network/unknown ${safeMethod} ${safeEndpoint}`,
        {
          downstream_url: safeEndpoint,
          downstream_method: safeMethod,
          axios_code: sanitizeForLog(
            axiosError.isAxiosError ? axiosError.code : undefined,
          ),
          error: sanitizeForLog(
            error instanceof Error ? error.message : String(error),
          ),
          stack: sanitizeForLog(
            error instanceof Error ? error.stack : undefined,
          ),
          request_id: requestId,
        },
      );
      throw new InternalServerErrorException();
    }
  }

  /**
   * FIXED: Forwards a client request using Node's native http/https modules with proper binary handling.
   * This is used for streaming (SSE) responses, multipart requests, and binary file transfers.
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
    headers: RawAxiosRequestHeaders = {},
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const isHTTPS = url.startsWith("https");

      const isSSE =
        clientRequest.headers.accept?.includes("text/event-stream") ?? false;
      const isMultipart =
        clientRequest.headers["content-type"]?.includes(
          "multipart/form-data",
        ) ?? false;

      const isBinaryFile = this.isBinaryFileRequest(
        clientRequest as UserSessionRequest,
      );

      const httpAgent = new http.Agent({
        keepAlive: true,
        timeout: 300_000,
      });
      const httpAgentNoKeepAlive = new http.Agent({
        keepAlive: false,
        timeout: 300_000,
      });
      const httpsAgent = new https.Agent({
        keepAlive: true,
        timeout: 300_000,
      });
      const httpsAgentNoKeepAlive = new https.Agent({
        keepAlive: false,
        timeout: 300_000,
      });

      const httpModule = isHTTPS ? https : http;
      const agent = isHTTPS
        ? isSSE || isMultipart || isBinaryFile
          ? httpsAgentNoKeepAlive
          : httpsAgent
        : isSSE || isMultipart || isBinaryFile
          ? httpAgentNoKeepAlive
          : httpAgent;

      const outgoingHeaders = this.normalizeOutgoingHeaders(
        clientRequest.headers,
        headers,
      );
      delete outgoingHeaders.host;

      if (!isBinaryFile) {
        delete outgoingHeaders["content-length"];
      }

      this.logger.info(`Forwarding ${clientRequest.method} request to ${url}`);
      this.logger.info(
        `Request type: SSE=${String(isSSE)}, Multipart=${String(
          isMultipart,
        )}, Binary=${String(isBinaryFile)}`,
      );

      const parsedUrl = new URL(url);
      const requestOptions: RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port ? Number(parsedUrl.port) : isHTTPS ? 443 : 80,
        path: parsedUrl.pathname + parsedUrl.search,
        method: clientRequest.method,
        headers: outgoingHeaders,
        agent,
        timeout: 300_000,
      };

      const proxyRequest = httpModule.request(
        requestOptions,
        (proxyResponse) => {
          const isStreaming =
            proxyResponse.headers["content-type"]?.includes(
              "text/event-stream",
            );

          if ((isMultipart || isBinaryFile) && !isStreaming) {
            this.logger.info(
              `Handling ${isBinaryFile ? "binary file" : "multipart"} response`,
            );

            const responseChunks: Buffer[] = [];

            proxyResponse.on("data", (chunk: Buffer) => {
              responseChunks.push(
                Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
              );
            });

            proxyResponse.on("end", () => {
              const responseBuffer = Buffer.concat(responseChunks);

              this.logger.info(
                `Binary response complete: ${responseBuffer.length} bytes`,
              );

              const responseHeaders = {
                ...proxyResponse.headers,
                "Content-Length": responseBuffer.length.toString(),
              };

              clientResponse.writeHead(
                proxyResponse.statusCode || 500,
                responseHeaders,
              );

              clientResponse.end(responseBuffer);
              resolve();
            });

            proxyResponse.on("error", (error) => {
              this.logger.error("Proxy response error:", error);
              if (!clientResponse.headersSent) {
                this.sendErrorResponse(
                  clientResponse,
                  500,
                  "Proxy response error",
                  false,
                );
              }
              reject(error);
            });
          } else if (isStreaming) {
            this.logger.info("Handling SSE streaming response");

            clientResponse.writeHead(proxyResponse.statusCode || 200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
              "X-Accel-Buffering": "no",
              ...proxyResponse.headers,
            });

            clientResponse.write(":ok\n\n");

            let connectionClosed = false;

            clientResponse.on("close", () => {
              this.logger.info("Client disconnected from SSE stream");
              connectionClosed = true;
              if (!proxyResponse.destroyed) {
                proxyResponse.destroy();
              }
              resolve();
            });

            proxyResponse.on("data", (chunk) => {
              if (!connectionClosed && !clientResponse.writableEnded) {
                try {
                  clientResponse.write(chunk);
                } catch (error) {
                  this.logger.error("Error writing to client:", error);
                  connectionClosed = true;
                }
              }
            });

            proxyResponse.on("end", () => {
              this.logger.info("SSE stream ended");
              if (!connectionClosed && !clientResponse.writableEnded) {
                clientResponse.end();
              }
              resolve();
            });

            proxyResponse.on("error", (error) => {
              this.logger.error("SSE proxy response error:", error);
              if (!connectionClosed && !clientResponse.writableEnded) {
                try {
                  clientResponse.write(
                    `data: ${JSON.stringify({
                      status: "error",
                      error: "Stream error",
                    })}\n\n`,
                  );
                  clientResponse.end();
                } catch (writeError) {
                  this.logger.error(
                    "Error writing error to client:",
                    writeError,
                  );
                }
              }
              resolve();
            });
          } else {
            clientResponse.writeHead(proxyResponse.statusCode || 500, {
              ...proxyResponse.headers,
            });

            proxyResponse.pipe(clientResponse);
            proxyResponse.on("end", resolve);

            clientResponse.on("close", () => {
              if (!proxyResponse.destroyed) {
                proxyResponse.destroy();
              }
            });
          }
        },
      );

      proxyRequest.on("timeout", () => {
        this.logger.error("Proxy request timeout");
        if (!clientResponse.headersSent) {
          if (isSSE) {
            try {
              clientResponse.writeHead(504, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
              });
              clientResponse.write(
                `data: ${JSON.stringify({
                  status: "error",
                  error: "Gateway timeout",
                })}\n\n`,
              );
              clientResponse.end();
            } catch (error) {
              this.logger.error("Failed to send SSE timeout response:", error);
            }
          } else {
            this.sendErrorResponse(clientResponse, 504, "Gateway timeout");
          }
        }
        proxyRequest.destroy();
        reject(new Error("Proxy request timeout"));
      });

      clientResponse.on("close", () => {
        this.logger.info("Client connection closed, destroying proxy request");
        if (!proxyRequest.destroyed) {
          proxyRequest.destroy();
        }
      });

      proxyRequest.on("error", (error) => {
        this.logger.error("Proxy request error:", error);
        if (!clientResponse.headersSent) {
          if (isSSE) {
            try {
              clientResponse.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
                "X-Accel-Buffering": "no",
              });
              clientResponse.write(
                `data: ${JSON.stringify({
                  status: "error",
                  error: "Proxy request failed",
                })}\n\n`,
              );
              clientResponse.end();
            } catch (writeError) {
              this.logger.error(
                "Failed to send SSE error response:",
                writeError,
              );
            }
          } else {
            this.sendErrorResponse(clientResponse, 500, "Proxy request failed");
          }
        }
        reject(error);
      });

      if (isMultipart || isBinaryFile) {
        this.logger.info(
          `Piping ${isMultipart ? "multipart" : "binary"} request stream`,
        );
        clientRequest.pipe(proxyRequest);
      } else {
        if (clientRequest.body) {
          const body: string | Buffer =
            typeof clientRequest.body === "object" &&
            !Buffer.isBuffer(clientRequest.body)
              ? JSON.stringify(clientRequest.body)
              : (clientRequest.body as string | Buffer);

          if (!isSSE) {
            proxyRequest.setHeader("Content-Length", Buffer.byteLength(body));
          }

          proxyRequest.write(body);
        }
        proxyRequest.end();
      }
    });
  }
}
