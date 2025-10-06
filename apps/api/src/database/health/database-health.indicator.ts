/**
 * DatabaseHealthIndicator - Database Health Check Implementation
 *
 * Provides health check functionality for the database connection
 * integrated with NestJS Terminus health check system.
 * Attempts automatic recovery when database connection issues are detected.
 *
 * This indicator is used by the health endpoints to report database status
 * and is critical for container orchestration health probes (liveness/readiness).
 *
 * @module database/health
 */

import { Injectable } from "@nestjs/common";
import { HealthIndicator, HealthIndicatorResult } from "@nestjs/terminus";
import { DatabaseCircuitBreakerService } from "../circuit-breaker/database-circuit-breaker.service";
import { PrismaService } from "../prisma.service";

@Injectable()
export class DatabaseHealthIndicator extends HealthIndicator {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly circuitBreaker: DatabaseCircuitBreakerService,
  ) {
    super();
  }

  /**
   * Performs a health check on the database connection
   * Attempts reconnection if the connection is unhealthy
   *
   * @param {string} key - Identifier for this health check (typically 'database')
   * @returns {Promise<HealthIndicatorResult>} Health status with metadata
   */
  async checkDatabase(key: string): Promise<HealthIndicatorResult> {
    try {
      const isHealthy = await this.circuitBreaker.execute(() =>
        this.prismaService.isHealthy(),
      );

      if (!isHealthy) {
        return await this.attemptRecovery(key);
      }

      return this.getStatus(key, true, {
        circuitBreaker: this.circuitBreaker.getStats(),
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      return this.getStatus(key, false, {
        message: errorMessage,
        circuitBreaker: this.circuitBreaker.getStats(),
      });
    }
  }

  /**
   * Attempts to recover the database connection
   * Called when health check indicates an unhealthy connection
   *
   * @private
   * @param {string} key - Health check identifier
   * @returns {Promise<HealthIndicatorResult>} Recovery result status
   */
  private async attemptRecovery(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.prismaService.reconnect();
      return this.getStatus(key, true, {
        message: "Database reconnected successfully",
        circuitBreaker: this.circuitBreaker.getStats(),
      });
    } catch (reconnectError: unknown) {
      const errorMessage =
        reconnectError instanceof Error
          ? reconnectError.message
          : "Unknown error occurred";
      return this.getStatus(key, false, {
        message: "Database connection lost and reconnection failed",
        error: errorMessage,
        circuitBreaker: this.circuitBreaker.getStats(),
      });
    }
  }
}
