import { Module } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";
import { DatabaseHealthIndicator } from "src/database/health/database-health.indicator";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

@Module({
  controllers: [HealthController],
  imports: [TerminusModule],
  providers: [HealthService, DatabaseHealthIndicator],
})
export class HealthModule {}
