/**
 * DatabaseConnectionMiddleware - Request-level Database Validation
 *
 * Middleware that validates database connectivity before processing requests.
 * Adds a degradation warning header if database issues are detected but
 * allows the request to continue (fail-open approach).
 *
 * This helps identify database issues early in the request lifecycle
 * and provides visibility into system health through response headers.
 *
 * @module database/middleware
 */

import { Injectable, Logger, NestMiddleware } from "@nestjs/common";
import { NextFunction, Request, Response } from "express";
import { DatabaseCircuitBreakerService } from "../circuit-breaker/database-circuit-breaker.service";
import { PrismaService } from "../prisma.service";

@Injectable()
export class DatabaseConnectionMiddleware implements NestMiddleware {
  private readonly logger = new Logger(DatabaseConnectionMiddleware.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly circuitBreaker: DatabaseCircuitBreakerService,
  ) {}

  /**
   * Middleware execution function
   * Checks database connectivity and adds warning headers if degraded
   *
   * @param {Request} request - Express request object
   * @param {Response} response - Express response object
   * @param {NextFunction} next - Express next function
   * @returns {Promise<void>}
   */
  async use(
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> {
    if (request.path.includes("/health")) {
      return next();
    }

    try {
      await this.circuitBreaker.execute(async () => {
        await this.prismaService.$queryRaw`SELECT 1`;
      });
    } catch (error) {
      this.logger.warn("Database connection check failed in middleware", error);

      response.setHeader("X-Database-Status", "degraded");
    }

    next();
  }
}
