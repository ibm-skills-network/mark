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
import {
  DiskHealthIndicator,
  HealthCheckResult,
  HealthCheckService,
} from "@nestjs/terminus";
import { DatabaseHealthIndicator } from "../database/health/database-health.indicator";

@Injectable()
export class HealthService {
  constructor(
    private readonly health: HealthCheckService,
    private readonly disk: DiskHealthIndicator,
    private readonly databaseHealthIndicator: DatabaseHealthIndicator,
  ) {}

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
   * Checks both system resources and database connectivity
   *
   * @returns {Promise<HealthCheckResult>} Liveness status
   */
  checkLiveness(): Promise<HealthCheckResult> {
    return this.health.check([
      () =>
        this.disk.checkStorage("storage", {
          path: "/",
          thresholdPercent: 0.9, // Alert if disk is 90% full
        }),
      () => this.databaseHealthIndicator.checkDatabase("database"),
    ]);
  }
}
