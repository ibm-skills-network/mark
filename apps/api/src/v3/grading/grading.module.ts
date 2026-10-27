import { Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { AdminAuthModule } from "../../auth/admin-auth.module";
import { GradingModesController } from "./admin/grading-modes.controller";
import { GradingModeService } from "./mode";
import { V3GradingService } from "./v3-grading.service";

/** Grader services. Imported by the attempt module (api and jobs). */
@Module({
  providers: [GradingModeService, V3GradingService],
  exports: [GradingModeService, V3GradingService],
})
export class GradingV3Module {}

/** HTTP surface: the mode switches. Imported by the api app only. */
@Module({
  imports: [
    GradingV3Module,
    AdminAuthModule,
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 30 }]),
  ],
  controllers: [GradingModesController],
})
export class GradingV3AdminModule {}
