import { Inject, Injectable } from "@nestjs/common";
import { AIUsageType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import {
  AiFeatureComponent,
  COMPONENT_BY_USAGE_TYPE,
  ENV_VAR_BY_COMPONENT,
} from "./ai-feature-flags.constants";
import { AiTemporarilyDisabledException } from "./ai-temporarily-disabled.exception";

/** Parses an env var with the app-wide "true"/"1"/"yes" idiom (case-insensitive). */
const parseEnvironmentFlag = (name: string): boolean =>
  ["1", "true", "yes"].includes((process.env[name] || "").toLowerCase().trim());

/**
 * Single source of truth for whether Mark's AI components are switched on.
 *
 * Phase 0 (this implementation): the disabled state is read from environment
 * variables at boot. This is the deploy-time fail-safe and the lever used to
 * stop spend immediately during a billing/provider incident.
 *
 * Phase 1 (follow-on): a DB-backed `AiFeatureFlag` table becomes the runtime
 * source of truth so an admin can toggle components live without a redeploy.
 * The env vars then seed the table at boot and the public method surface here
 * stays the same — only the internals of {@link isDisabled} change.
 */
@Injectable()
export class AiFeatureFlagsService {
  private readonly logger: Logger;

  /** Disabled-by-env state for each component, computed once at construction. */
  private readonly disabledByEnv: Record<AiFeatureComponent, boolean>;

  constructor(@Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger) {
    this.logger = parentLogger.child({ context: AiFeatureFlagsService.name });
    this.disabledByEnv = this.readEnv();
    this.logInitialState();
  }

  /**
   * Whether the given component is currently disabled. The `ALL` master kill
   * forces every component disabled regardless of its individual flag.
   */
  isDisabled(component: AiFeatureComponent): boolean {
    if (component !== AiFeatureComponent.ALL && this.disabledByEnv.ALL) {
      return true;
    }
    return this.disabledByEnv[component] ?? false;
  }

  isEnabled(component: AiFeatureComponent): boolean {
    return !this.isDisabled(component);
  }

  /**
   * Whether the component governing the given LLM usage type is disabled.
   * Usage types not mapped to a component are never gated.
   */
  isDisabledForUsage(usageType: AIUsageType): boolean {
    const component = COMPONENT_BY_USAGE_TYPE[usageType];
    if (!component) return false;
    return this.isDisabled(component);
  }

  /**
   * Throws {@link AiTemporarilyDisabledException} if the component governing
   * `usageType` is disabled. Called at the LLM provider chokepoint so no paid
   * call is ever made for a disabled component.
   */
  assertUsageEnabled(usageType: AIUsageType): void {
    if (this.isDisabledForUsage(usageType)) {
      const component = COMPONENT_BY_USAGE_TYPE[usageType];
      this.logger.warn("ai.killswitch.backstop", {
        usageType,
        component,
        message: "Blocked LLM call for disabled AI component",
      });
      throw new AiTemporarilyDisabledException();
    }
  }

  /**
   * Client-safe view of which learner/author facing components are enabled.
   * Contains no secrets — safe to expose on a public endpoint.
   */
  getStatus(): { grading: boolean; chat: boolean; authoring: boolean } {
    return {
      grading: this.isEnabled(AiFeatureComponent.GRADING),
      chat: this.isEnabled(AiFeatureComponent.CHAT),
      authoring: this.isEnabled(AiFeatureComponent.AUTHORING),
    };
  }

  private readEnv(): Record<AiFeatureComponent, boolean> {
    return {
      [AiFeatureComponent.ALL]: parseEnvironmentFlag(
        ENV_VAR_BY_COMPONENT[AiFeatureComponent.ALL],
      ),
      [AiFeatureComponent.GRADING]: parseEnvironmentFlag(
        ENV_VAR_BY_COMPONENT[AiFeatureComponent.GRADING],
      ),
      [AiFeatureComponent.CHAT]: parseEnvironmentFlag(
        ENV_VAR_BY_COMPONENT[AiFeatureComponent.CHAT],
      ),
      [AiFeatureComponent.AUTHORING]: parseEnvironmentFlag(
        ENV_VAR_BY_COMPONENT[AiFeatureComponent.AUTHORING],
      ),
    };
  }

  private logInitialState(): void {
    const anyDisabled = Object.values(this.disabledByEnv).some(Boolean);
    const payload = {
      master: this.isDisabled(AiFeatureComponent.ALL),
      grading: this.isDisabled(AiFeatureComponent.GRADING),
      chat: this.isDisabled(AiFeatureComponent.CHAT),
      authoring: this.isDisabled(AiFeatureComponent.AUTHORING),
    };
    if (anyDisabled) {
      this.logger.warn("ai.killswitch.boot", payload);
    } else {
      this.logger.info("ai.killswitch.boot", payload);
    }
  }
}
