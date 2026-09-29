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
import {
  GithubCredentialCheckService,
  GithubCredentialState,
} from "../api/github/github-credential-check.service";

export interface IntegrationsReport {
  status: "ok" | "degraded";
  checks: {
    name: string;
    state: GithubCredentialState;
    checkedAt: string | null;
  }[];
}

const DEGRADED_STATES = new Set<GithubCredentialState>([
  "misconfigured",
  "not_configured",
]);

@Injectable()
export class HealthService {
  constructor(
    private readonly health: HealthCheckService,
    private readonly githubCredentials: GithubCredentialCheckService,
  ) {}

  /**
   * Configuration-level health of outbound integrations. Returns 200 whatever
   * the outcome — this is for operators and alerting, not for the orchestrator.
   */
  checkIntegrations(): IntegrationsReport {
    const github = this.githubCredentials.getStatus();
    return {
      status: DEGRADED_STATES.has(github.state) ? "degraded" : "ok",
      checks: [
        {
          name: "github_oauth",
          state: github.state,
          checkedAt: github.checkedAt,
        },
      ],
    };
  }

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
    return this.health.check([]);
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
