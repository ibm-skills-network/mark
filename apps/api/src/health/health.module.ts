import { Module } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";
import { PrismaService } from "src/prisma.service";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

@Module({
  controllers: [HealthController],
  imports: [TerminusModule],
  providers: [HealthService, PrismaService],
})
export class HealthModule {}
