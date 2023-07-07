import { Controller, Get, VERSION_NEUTRAL } from "@nestjs/common";
import { HealthCheck } from "@nestjs/terminus";
import { Public } from "../auth/jwt/jwt.global.auth.guard";
import { HealthService } from "./health.service";

@Controller({ version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @Public()
  @HealthCheck()
  check() {
    return this.healthService.checkLiveness();
  }

  @Get("liveness")
  @Public()
  @HealthCheck()
  liveness() {
    return this.healthService.checkLiveness();
  }

  @Get("readiness")
  @Public()
  @HealthCheck()
  readiness() {
    return this.healthService.checkReadiness();
  }
}
