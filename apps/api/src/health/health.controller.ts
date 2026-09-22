import { Controller, Get, UseGuards, VERSION_NEUTRAL } from "@nestjs/common";
import { HealthCheck } from "@nestjs/terminus";
import { AdminGuard } from "../auth/guards/admin.guard";
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
   * a broken integration must not take the pod out of rotation.
   *
   * Admin-gated rather than open. The route is excluded from the public API
   * prefix, but the ingress routes `/` to this app, so prefix exclusion is a
   * routing decision and not a network boundary — which integration is broken,
   * and since when, is operator detail and not something to hand out anonymously.
   * The liveness and readiness probes stay open: the orchestrator cannot
   * present credentials.
   */
  @Get("integrations")
  @UseGuards(AdminGuard)
  integrations(): IntegrationsReport {
    return this.healthService.checkIntegrations();
  }
}
