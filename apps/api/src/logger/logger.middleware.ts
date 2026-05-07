import { Inject, Injectable, NestMiddleware } from "@nestjs/common";
import { NextFunction, Request, Response } from "express";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";

const SLOW_REQUEST_THRESHOLD_MS = 5000;

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  use(request: Request, response: Response, next: NextFunction) {
    const start = process.hrtime();

    const requestId = request.get("akamai-grn") ?? request.get("x-request-id");

    this.logger.debug(`→ ${request.method} ${request.originalUrl}`, {
      method: request.method,
      url: request.originalUrl,
      request_id: requestId,
      client_ip: request.get("true-client-ip"),
      user_agent: request.get("user-agent") || "",
      referer: request.get("referer") || "",
      content_length_in: request.get("content-length"),
    });

    response.on("finish", () => {
      const diff = process.hrtime(start);
      const responseTimeMs = diff[0] * 1e3 + diff[1] * 1e-6;

      const requestDetails = {
        client_ip: request.get("true-client-ip"),
        transaction_id: request.get("x-transaction-id"),
        request_id: requestId,
        method: request.method,
        url: request.originalUrl,
        status_code: response.statusCode,
        content_length: response.get("content-length"),
        user_agent: request.get("user-agent") || "",
        referer: request.get("referer") || "",
        response_time_ms: Number(responseTimeMs.toFixed(2)),
      };

      const message = `${requestDetails.method} ${requestDetails.url} ${
        requestDetails.status_code
      } - ${responseTimeMs.toFixed(2)}ms`;

      if (response.statusCode >= 500) {
        this.logger.error(message, {
          ...requestDetails,
          slow_request: responseTimeMs >= SLOW_REQUEST_THRESHOLD_MS,
        });
      } else if (response.statusCode >= 400) {
        this.logger.warn(message, requestDetails);
      } else {
        this.logger.info(message, requestDetails);
      }

      if (
        responseTimeMs >= SLOW_REQUEST_THRESHOLD_MS &&
        response.statusCode < 500
      ) {
        this.logger.warn(
          `slow_request: ${requestDetails.method} ${requestDetails.url} took ${responseTimeMs.toFixed(2)}ms`,
          { ...requestDetails, slow_request: true },
        );
      }
    });

    response.on("close", () => {
      if (!response.writableEnded) {
        const diff = process.hrtime(start);
        const responseTimeMs = diff[0] * 1e3 + diff[1] * 1e-6;
        this.logger.warn(
          `client_disconnected: ${request.method} ${request.originalUrl} after ${responseTimeMs.toFixed(2)}ms`,
          {
            method: request.method,
            url: request.originalUrl,
            request_id: requestId,
            user_agent: request.get("user-agent") || "",
            referer: request.get("referer") || "",
            response_time_ms: Number(responseTimeMs.toFixed(2)),
            client_disconnected: true,
          },
        );
      }
    });

    next();
  }
}
