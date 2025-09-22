import { Injectable } from "@nestjs/common";
import {
  DiskHealthIndicator,
  HealthCheckResult,
  HealthCheckService,
  PrismaHealthIndicator,
} from "@nestjs/terminus";
import { PrismaService } from "../prisma.service";

@Injectable()
export class HealthService {
  constructor(
    private readonly health: HealthCheckService,
    private readonly disk: DiskHealthIndicator,
    private readonly prisma: PrismaHealthIndicator,
    private readonly prismaService: PrismaService,
  ) {}

  checkReadiness(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  checkLiveness(): Promise<HealthCheckResult> {
    return this.health.check([
      () =>
        this.disk.checkStorage("storage", { path: "/", thresholdPercent: 0.9 }),
      () =>
        this.prisma.pingCheck("database", this.prismaService, {
          timeout: 5000,
        }),
    ]);
  }
}
