import { Controller, Get, VERSION_NEUTRAL } from "@nestjs/common";
import { HealthCheck } from "@nestjs/terminus";
import { HealthService } from "./health.service";

@Controller({ version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @HealthCheck()
  check() {
    return this.healthService.checkLiveness();
  }

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
}
