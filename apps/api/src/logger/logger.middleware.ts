import { Inject, Injectable, NestMiddleware } from "@nestjs/common";
import { NextFunction, Request, Response } from "express";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  use(request: Request, response: Response, next: NextFunction) {
    const start = process.hrtime();

    response.on("finish", () => {
      const diff = process.hrtime(start);
      const responseTimeMs = diff[0] * 1e3 + diff[1] * 1e-6;

      const requestDetails = {
        client_ip: request.get("true-client-ip"),
        transaction_id: request.get("x-transaction-id"),
        request_id: request.get("akamai-grn") ?? request.get("x-request-id"),
        method: request.method,
        url: request.originalUrl,
        status_code: response.statusCode,
        content_length: response.get("content-length"),
        user_agent: request.get("user-agent") || "",
      };

      this.logger.info(
        `${requestDetails.method} ${requestDetails.url} ${
          requestDetails.status_code
        } - ${responseTimeMs.toFixed(2)}ms`,
        requestDetails,
      );
    });

    next();
  }
}
