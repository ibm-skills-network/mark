import { Injectable } from "@nestjs/common";
import {
  DiskHealthIndicator,
  HealthCheckResult,
  HealthCheckService,
} from "@nestjs/terminus";

@Injectable()
export class HealthService {
  constructor(
    private readonly health: HealthCheckService,
    private readonly disk: DiskHealthIndicator,
  ) {}

  checkReadiness(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  checkLiveness(): Promise<HealthCheckResult> {
    return this.health.check([
      () =>
        this.disk.checkStorage("storage", { path: "/", thresholdPercent: 0.9 }),
    ]);
  }
}
