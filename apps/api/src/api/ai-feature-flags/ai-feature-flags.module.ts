import { Global, Module } from "@nestjs/common";
import { AiFeatureFlagsService } from "./ai-feature-flags.service";
import { AiStatusController } from "./ai-status.controller";
import { GradingKillSwitchService } from "./grading-kill-switch.service";

/**
 * Global module exposing the AI kill-switch. Marked `@Global()` so the
 * {@link AiFeatureFlagsService} can be injected anywhere (grading, chat,
 * attempt lifecycle, prompt processor) without each consumer importing this
 * module.
 */
@Global()
@Module({
  controllers: [AiStatusController],
  providers: [AiFeatureFlagsService, GradingKillSwitchService],
  exports: [AiFeatureFlagsService, GradingKillSwitchService],
})
export class AiFeatureFlagsModule {}
