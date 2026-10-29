import { Module } from "@nestjs/common";
import { GradingV3Module } from "../v3/grading/grading.module";

/**
 * Legacy grading's only way into v3: re-exports the v3 grader services for
 * the attempt module (api and jobs) to inject into GradingBridgeService.
 */
@Module({
  imports: [GradingV3Module],
  exports: [GradingV3Module],
})
export class GradingBridgeModule {}
