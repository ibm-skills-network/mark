/* eslint-disable unicorn/no-nested-ternary */
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
  /**
   * Forward SSE requests specifically
   */
  async forwardSSERequest(
    clientRequest: Request,
    clientResponse: Response,
    url: string,
    headers: Record<string, any> = {},
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const isHTTPS = url.startsWith("https");
      const httpModule = isHTTPS ? https : http;

      // Parse URL for request options
      const parsedUrl = new URL(url);

      const outgoingHeaders = {
        ...clientRequest.headers,
        ...headers,
        host: parsedUrl.hostname,
        accept: "text/event-stream",
      };

      delete outgoingHeaders["content-length"];

      this.logger.info(`Forwarding SSE request to ${url}`);

      const requestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHTTPS ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: "GET",
        headers: outgoingHeaders,
        timeout: 300_000, // 5 minutes
      };

      const proxyRequest = httpModule.request(
        requestOptions,
        (proxyResponse) => {
          this.logger.info(
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            `SSE response received: ${proxyResponse.statusCode}`,
          );

          // Forward SSE headers
          clientResponse.writeHead(proxyResponse.statusCode || 200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
            ...proxyResponse.headers,
          });

          // Pipe the response
          proxyResponse.pipe(clientResponse);

          // Handle client disconnect
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
          clientResponse
            .status(500)
            .json({ error: "SSE proxy request failed" });
        }
        reject(error);
      });

      proxyRequest.on("timeout", () => {
        this.logger.error("SSE proxy request timeout");
        proxyRequest.destroy();
        if (!clientResponse.headersSent) {
          clientResponse.status(504).json({ error: "Gateway timeout" });
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
    try {
      if (!request.originalUrl) {
        throw new BadRequestException();
      }

      const { endpoint, extraHeaders } = this.getForwardingDetails(
        forwardingService,
        request,
      );

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
            writeHead(
              this: MockResponse,
              statusCode: number,
              headers: Record<string, unknown>,
            ): void;
            write(this: MockResponse, chunk: string | Buffer): void;
            end(this: MockResponse, chunk?: string | Buffer): void;
            on(
              event: string,
              listener: (...arguments_: unknown[]) => void,
            ): void;
            once(
              event: string,
              listener: (...arguments_: unknown[]) => void,
            ): void;
            pipe<T>(this: MockResponse, destination: T): T;
          }

          const mockResponse: MockResponse = {
            statusCode: 200,
            headers: {},
            data: Buffer.alloc(0),
            writeHead(
              this: MockResponse,
              statusCode: number,
              headers: Record<string, unknown>,
            ) {
              this.statusCode = statusCode;
              this.headers = headers;
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

              const dataToReturn = isBinaryFile
                ? this.data.toString("base64")
                : this.data.toString("utf8");

              resolve({
                data: dataToReturn,
                status: this.statusCode,
              });
            },
            on(
              _event: string,
              _listener: (...arguments_: unknown[]) => void,
            ): void {
              // Intentionally left blank for mock
            },
            once(
              _event: string,
              _listener: (...arguments_: unknown[]) => void,
            ): void {
              // Intentionally left blank for mock
            },
            pipe<T>(this: MockResponse, _destination: T): T {
              return this as unknown as T;
            },
          };

          this.forwardRequestUsingHttp(
            request as Request,
            mockResponse as unknown as Response,
            endpoint,
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
    headers: Record<string, any> = {},
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

      // Set up agents with appropriate timeout settings
      const httpAgent = new http.Agent({
        keepAlive: true,
        timeout: 300_000, // 5 minutes
      });
      const httpAgentNoKeepAlive = new http.Agent({
        keepAlive: false,
        timeout: 300_000, // 5 minutes
      });
      const httpsAgent = new https.Agent({
        keepAlive: true,
        timeout: 300_000, // 5 minutes
      });
      const httpsAgentNoKeepAlive = new https.Agent({
        keepAlive: false,
        timeout: 300_000, // 5 minutes
      });

      const httpModule = isHTTPS ? https : http;
      const agent = isHTTPS
        ? isSSE || isMultipart || isBinaryFile
          ? httpsAgentNoKeepAlive
          : httpsAgent
        : isSSE || isMultipart || isBinaryFile
          ? httpAgentNoKeepAlive
          : httpAgent;

      const outgoingHeaders = {
        ...clientRequest.headers,
        ...headers,
      };
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

      // Parse URL for request options
      const parsedUrl = new URL(url);
      const requestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHTTPS ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: clientRequest.method,
        headers: outgoingHeaders,
        agent,
        timeout: 300_000, // 5 minutes
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
                clientResponse.status(500).end();
              }
              reject(error);
            });
          } else if (isStreaming) {
            // Handle SSE streaming with proper headers and connection management
            this.logger.info("Handling SSE streaming response");

            // Immediately flush headers to establish connection
            clientResponse.writeHead(proxyResponse.statusCode || 200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
              "X-Accel-Buffering": "no", // Disable nginx buffering
              ...proxyResponse.headers,
            });

            // Send an initial comment to establish the connection
            clientResponse.write(":ok\n\n");

            // Track connection state
            let connectionClosed = false;

            // Handle client disconnect
            clientResponse.on("close", () => {
              this.logger.info("Client disconnected from SSE stream");
              connectionClosed = true;
              if (!proxyResponse.destroyed) {
                proxyResponse.destroy();
              }
              resolve();
            });

            // Stream data from proxy to client
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
            // Regular response handling
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

      // Handle proxy request timeout
      proxyRequest.on("timeout", () => {
        this.logger.error("Proxy request timeout");
        if (!clientResponse.headersSent) {
          if (isSSE) {
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
          } else {
            clientResponse.status(504).json({ error: "Gateway timeout" });
          }
        }
        proxyRequest.destroy();
        reject(new Error("Proxy request timeout"));
      });

      // Clean up on client disconnect
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
            // For SSE, we need to establish the connection first
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
          } else {
            clientResponse.status(500).json({ error: "Proxy request failed" });
          }
        }
        reject(error);
      });

      // Handle request body
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

          // Add content-length for non-streaming requests
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
