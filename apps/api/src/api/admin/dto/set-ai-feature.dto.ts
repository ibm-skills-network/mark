import { IsBoolean, IsEnum } from "class-validator";
import { AiFeatureComponent } from "../../ai-feature-flags/ai-feature-flags.constants";

/**
 * Body for the admin AI kill-switch toggle. `component` must be one of the
 * known components ("ALL" master, "GRADING", "CHAT", "AUTHORING"); `enabled`
 * is the desired state (true = AI on).
 */
export class SetAiFeatureDto {
  @IsEnum(AiFeatureComponent)
  component: AiFeatureComponent;

  @IsBoolean()
  enabled: boolean;
}
