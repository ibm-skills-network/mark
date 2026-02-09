/**
 * HealthService - Application Health Check Service
 *
 * Provides health check endpoints for container orchestration platforms.
 * Implements both liveness and readiness probes following Kubernetes standards:
 * - Liveness: Indicates if the application should be restarted
 * - Readiness: Indicates if the application is ready to receive traffic
 *
 * Integrates with NestJS Terminus for standardized health check responses.
 *
 * @module health
 */

import { Injectable } from "@nestjs/common";
import { HealthCheckResult, HealthCheckService } from "@nestjs/terminus";
import { DatabaseHealthIndicator } from "../database/health/database-health.indicator";

@Injectable()
export class HealthService {
  constructor(
    private readonly health: HealthCheckService,
    private readonly databaseHealthIndicator: DatabaseHealthIndicator,
  ) {}

  /**
   * Basic health probe - verifies the API is responsive without
   * checking external dependencies.
   *
   * @returns {Promise<HealthCheckResult>} Health status
   */
  checkHealth(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  /**
   * Readiness probe - checks if the application is ready to receive traffic
   * Only checks critical dependencies required for handling requests
   *
   * @returns {Promise<HealthCheckResult>} Readiness status
   */
  checkReadiness(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.databaseHealthIndicator.checkDatabase("database"),
    ]);
  }

  /**
   * Liveness probe - checks if the application is alive and functioning
   * Does not check external dependencies
   *
   * @returns {Promise<HealthCheckResult>} Liveness status
   */
  checkLiveness(): Promise<HealthCheckResult> {
    return this.checkHealth();
  }
}
