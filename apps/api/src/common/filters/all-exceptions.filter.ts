/**
 * Global exception filter for the Mark API.
 *
 * Catches every unhandled error in the request pipeline and emits a structured
 * Winston log entry with method, url, user id, status, stack, and (when the
 * error is from Prisma) the error code plus current circuit-breaker state.
 *
 * Without this filter, NestJS's default behavior is to return a bare 500 with
 * no context
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
import { Prisma } from "@prisma/client";
import { Request, Response } from "express";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { DatabaseCircuitBreakerService } from "../../database/circuit-breaker/database-circuit-breaker.service";
import { UserSessionRequest } from "../../auth/interfaces/user.session.interface";

const PRISMA_POOL_CODES = new Set(["P1001", "P1008", "P1017", "P2024"]);

/**
 * The same lost-connection event can surface without a Prisma code: when the
 * database (or the pooler in front of it) drops its server connections, the
 * query that was in flight fails with the pooler's or Postgres's own words.
 * Those are as momentary as a coded P1017 and must be answered the same way.
 */
const LOST_CONNECTION_MESSAGE =
  /server conn crashed|server has closed the connection|terminating connection due to administrator command|connection terminated unexpectedly|server closed the connection unexpectedly/i;

/** Seconds a client should wait before retrying a 503 from a connection blip. */
const DB_UNAVAILABLE_RETRY_AFTER_SECONDS = "1";

interface ErrorContext {
  method: string;
  url: string;
  status: number;
  request_id?: string;
  transaction_id?: string;
  user_id?: string;
  user_role?: string;
  exception_name: string;
  message: string;
  stack?: string;
  prisma_code?: string;
  prisma_meta?: unknown;
  circuit_breaker?: ReturnType<DatabaseCircuitBreakerService["getStats"]>;
  body_keys?: string[];
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
    private readonly circuitBreaker: DatabaseCircuitBreakerService,
  ) {
    this.logger = parentLogger.child({ context: AllExceptionsFilter.name });
  }

  private readonly logger: Logger;

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & Partial<UserSessionRequest>>();
    const response = http.getResponse<Response>();

    const status = this.resolveStatus(exception);
    const exceptionName =
      exception instanceof Error
        ? exception.constructor.name
        : typeof exception;
    const message =
      exception instanceof Error ? exception.message : String(exception);

    const context: ErrorContext = {
      method: request.method,
      url: request.originalUrl,
      status,
      request_id:
        request.get("akamai-grn") ?? request.get("x-request-id") ?? undefined,
      transaction_id: request.get("x-transaction-id") ?? undefined,
      user_id: request.userSession?.userId,
      user_role: request.userSession?.role,
      exception_name: exceptionName,
      message,
      stack: exception instanceof Error ? exception.stack : undefined,
      body_keys:
        request.body && typeof request.body === "object"
          ? Object.keys(request.body as Record<string, unknown>)
          : undefined,
    };

    if (this.isPrismaError(exception)) {
      context.prisma_code =
        "code" in exception && typeof exception.code === "string"
          ? exception.code
          : undefined;
      if ("meta" in exception) {
        context.prisma_meta = (exception as { meta?: unknown }).meta;
      }
      context.circuit_breaker = this.circuitBreaker.getStats();
      if (this.isLostConnection(exception)) {
        this.logger.error(
          `DB pool/connection error ${context.prisma_code ?? "lost-connection"}: ${context.method} ${context.url}`,
          context,
        );
      } else {
        this.logger.error(
          `Prisma error ${context.prisma_code ?? "unknown"}: ${context.method} ${context.url}`,
          context,
        );
      }
    } else if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
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

    const lostConnection = this.isLostConnection(exception);
    const responseBody =
      exception instanceof HttpException
        ? exception.getResponse()
        : {
            statusCode: status,
            message: lostConnection
              ? "Service temporarily unavailable"
              : status >= HttpStatus.INTERNAL_SERVER_ERROR
                ? "Internal server error"
                : message,
          };

    if (!response.headersSent) {
      if (lostConnection) {
        response.setHeader("Retry-After", DB_UNAVAILABLE_RETRY_AFTER_SECONDS);
      }
      response.status(status).json(responseBody);
    }
  }

  private resolveStatus(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }
    if (this.isPrismaError(exception)) {
      const code =
        "code" in exception && typeof exception.code === "string"
          ? exception.code
          : undefined;
      if (code === "P2025") return HttpStatus.NOT_FOUND;
      if (code === "P2002") return HttpStatus.CONFLICT;
      if (code === "P2003") return HttpStatus.BAD_REQUEST;
      if (this.isLostConnection(exception))
        return HttpStatus.SERVICE_UNAVAILABLE;
    }
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  /**
   * True when the database could not be reached or dropped the connection
   * mid-query: a pool/connection Prisma code, or an uncoded request error whose
   * message is the pooler's or Postgres's lost-connection report.
   */
  private isLostConnection(exception: unknown): boolean {
    if (!this.isPrismaError(exception)) return false;
    const code =
      "code" in exception && typeof exception.code === "string"
        ? exception.code
        : undefined;
    if (code && PRISMA_POOL_CODES.has(code)) return true;
    return (
      exception instanceof Prisma.PrismaClientUnknownRequestError &&
      LOST_CONNECTION_MESSAGE.test(exception.message)
    );
  }

  private isPrismaError(
    exception: unknown,
  ): exception is
    | Prisma.PrismaClientKnownRequestError
    | Prisma.PrismaClientUnknownRequestError
    | Prisma.PrismaClientRustPanicError
    | Prisma.PrismaClientInitializationError
    | Prisma.PrismaClientValidationError {
    return (
      exception instanceof Prisma.PrismaClientKnownRequestError ||
      exception instanceof Prisma.PrismaClientUnknownRequestError ||
      exception instanceof Prisma.PrismaClientRustPanicError ||
      exception instanceof Prisma.PrismaClientInitializationError ||
      exception instanceof Prisma.PrismaClientValidationError
    );
  }
}
