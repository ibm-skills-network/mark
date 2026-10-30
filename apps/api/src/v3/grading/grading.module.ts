import { Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { AdminAuthModule } from "../../auth/admin-auth.module";
import { GradingBoostController } from "./admin/grading-boost.controller";
import { GradingModesController } from "./admin/grading-modes.controller";
import { GradingBoostService } from "./boost";
import { GradingModeService } from "./mode";
import { V3GradingService } from "./v3-grading.service";

/** Grader services. Reaches legacy grading through src/grading-bridge. */
@Module({
  providers: [GradingModeService, GradingBoostService, V3GradingService],
  exports: [GradingModeService, GradingBoostService, V3GradingService],
})
export class GradingV3Module {}

/** HTTP surface: the mode switches and the boost. Registered by the api app only. */
@Module({
  imports: [
    GradingV3Module,
    AdminAuthModule,
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 30 }]),
  ],
  controllers: [GradingModesController, GradingBoostController],
})
export class GradingV3AdminModule {}
