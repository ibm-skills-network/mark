/**
 * Global exception filter for the API Gateway.
 *
 * Catches every unhandled error (forwarding failures, Axios network errors,
 * auth exceptions) and emits a structured Winston log entry with method, url,
 * status, exception type, stack, downstream response shape if available.
 *
 * @module common/filters
 */
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
} from "@nestjs/common";
import { AxiosError } from "axios";
import { Request, Response } from "express";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";

interface GatewayErrorContext {
  method: string;
  url: string;
  status: number;
  request_id?: string;
  transaction_id?: string;
  exception_name: string;
  message: string;
  stack?: string;
  downstream_status?: number;
  downstream_code?: string;
  downstream_url?: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger) {
    this.logger = parentLogger.child({ context: AllExceptionsFilter.name });
  }

  private readonly logger: Logger;

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const status = this.resolveStatus(exception);
    const exceptionName =
      exception instanceof Error
        ? exception.constructor.name
        : typeof exception;
    const message =
      exception instanceof Error ? exception.message : String(exception);

    const context: GatewayErrorContext = {
      method: request.method,
      url: request.originalUrl,
      status,
      request_id:
        request.get("akamai-grn") ?? request.get("x-request-id") ?? undefined,
      transaction_id: request.get("x-transaction-id") ?? undefined,
      exception_name: exceptionName,
      message,
      stack: exception instanceof Error ? exception.stack : undefined,
    };

    if (this.isAxiosError(exception)) {
      context.downstream_status = exception.response?.status;
      context.downstream_code = exception.code;
      context.downstream_url = exception.config?.url;
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `Unhandled ${exceptionName}: ${context.method} ${context.url} -> ${status}`,
        context,
      );
    } else {
      this.logger.warn(
        `${exceptionName}: ${context.method} ${context.url} -> ${status}`,
        context,
      );
    }

    const responseBody =
      exception instanceof HttpException
        ? exception.getResponse()
        : {
            statusCode: status,
            message:
              status >= HttpStatus.INTERNAL_SERVER_ERROR
                ? "Internal server error"
                : message,
          };

    if (!response.headersSent) {
      response.status(status).json(responseBody);
    }
  }

  private resolveStatus(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }
    if (this.isAxiosError(exception)) {
      return exception.response?.status ?? HttpStatus.BAD_GATEWAY;
    }
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private isAxiosError(exception: unknown): exception is AxiosError {
    return (
      typeof exception === "object" &&
      exception !== null &&
      "isAxiosError" in exception &&
      (exception as { isAxiosError: unknown }).isAxiosError === true
    );
  }
}
