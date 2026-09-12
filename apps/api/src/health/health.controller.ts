import { Controller, Get, VERSION_NEUTRAL } from "@nestjs/common";
import { HealthCheck } from "@nestjs/terminus";
import { HealthService, IntegrationsReport } from "./health.service";

@Controller({ version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get("liveness")
  @HealthCheck()
  liveness() {
    return this.healthService.checkLiveness();
  }

  @Get("readiness")
  @HealthCheck()
  readiness() {
    return this.healthService.checkReadiness();
  }

  /**
   * Reports integrations that can be broken by configuration alone without the
   * pod ever looking unhealthy. Deliberately not part of the readiness probe:
   * a broken integration must not take the pod out of rotation. Excluded from
   * the public API prefix, so it stays reachable in-cluster only.
   */
  @Get("integrations")
  integrations(): IntegrationsReport {
    return this.healthService.checkIntegrations();
  }
}
