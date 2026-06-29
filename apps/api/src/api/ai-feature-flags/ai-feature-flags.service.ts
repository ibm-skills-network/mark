import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { AIUsageType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { PrismaService } from "../../database/prisma.service";
import {
  AiFeatureComponent,
  COMPONENT_BY_USAGE_TYPE,
  ENV_VAR_BY_COMPONENT,
} from "./ai-feature-flags.constants";
import { AiTemporarilyDisabledException } from "./ai-temporarily-disabled.exception";

/** Parses an env var with the app-wide "true"/"1"/"yes" idiom (case-insensitive). */
const parseEnvironmentFlag = (name: string): boolean =>
  ["1", "true", "yes"].includes((process.env[name] || "").toLowerCase().trim());

/** Whether an env var was explicitly provided (vs absent/empty). */
const isEnvironmentExplicitlySet = (name: string): boolean => {
  const value = process.env[name];
  return value !== undefined && value.trim() !== "";
};

const ALL_COMPONENTS: AiFeatureComponent[] = [
  AiFeatureComponent.ALL,
  AiFeatureComponent.GRADING,
  AiFeatureComponent.CHAT,
  AiFeatureComponent.AUTHORING,
];

/** How often each pod re-reads the DB snapshot (admin flips propagate within this). */
const DEFAULT_REFRESH_MS = 10_000;

export interface AiFeatureFlagState {
  component: AiFeatureComponent;
  /** Raw stored enabled value for this component (ignores the master switch). */
  enabled: boolean;
  /** Effective disabled state, i.e. with the ALL master applied. */
  disabled: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

/**
 * Single source of truth for whether Mark's AI components are switched on.
 *
 * Sources, in precedence order:
 *  - **Boot:** each explicitly-set env var (`AI_FEATURES_DISABLED`, etc.)
 *    upserts its DB row, so env is the deploy-time default / fail-safe.
 *  - **Runtime:** the `AiFeatureFlag` table is authoritative. An admin toggle
 *    writes a row and it takes effect within one refresh interval on every pod.
 *
 * Reads are synchronous against an in-memory snapshot (initialised from env at
 * construction so they are safe before the first DB load and if the DB is
 * briefly unreachable). The `ALL` master, when disabled, forces every component
 * disabled.
 */
@Injectable()
export class AiFeatureFlagsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger: Logger;

  /** Raw enabled-state per component (master applied at read time, not here). */
  private snapshot: Record<AiFeatureComponent, boolean>;

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: AiFeatureFlagsService.name });
    // Seed the in-memory snapshot from env so reads are correct immediately,
    // before OnModuleInit loads the DB and as a fallback if the DB is down.
    this.snapshot = this.readEnvAsEnabled();
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.seedFromEnv();
      await this.refreshSnapshot();
    } catch (error) {
      // Fail safe: keep the env-derived snapshot (already set in the
      // constructor) rather than crash boot if the DB is briefly unreachable.
      this.logger.error("ai.killswitch.init.failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
    this.refreshTimer = setInterval(() => {
      void this.refreshSnapshot().catch((error) => {
        this.logger.warn("ai.killswitch.refresh.failed", {
          message: error instanceof Error ? error.message : String(error),
        });
      });
    }, DEFAULT_REFRESH_MS);
    // Don't keep the event loop alive solely for this timer.
    this.refreshTimer.unref?.();
    this.logInitialState();
  }

  onModuleDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  /**
   * Whether the given component is currently disabled. The `ALL` master kill
   * forces every component disabled regardless of its individual flag.
   */
  isDisabled(component: AiFeatureComponent): boolean {
    if (component !== AiFeatureComponent.ALL && !this.snapshot.ALL) {
      return true;
    }
    return !(this.snapshot[component] ?? true);
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

  /**
   * Full per-component state for the admin UI, including who last changed each
   * row and when. Reads through to the DB so the metadata is current.
   */
  async getAllFlags(): Promise<AiFeatureFlagState[]> {
    const rows = await this.prisma.aiFeatureFlag.findMany();
    const byComponent = new Map(rows.map((r) => [r.component, r]));
    return ALL_COMPONENTS.map((component) => {
      const row = byComponent.get(component);
      return {
        component,
        enabled: row ? row.enabled : true,
        disabled: this.isDisabled(component),
        updatedBy: row?.updatedBy ?? null,
        updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
      };
    });
  }

  /**
   * Sets a component's enabled state (admin toggle). Persists to the DB and
   * refreshes this pod's snapshot immediately; other pods pick it up on their
   * next refresh.
   */
  async setEnabled(
    component: AiFeatureComponent,
    enabled: boolean,
    updatedBy: string,
  ): Promise<AiFeatureFlagState[]> {
    await this.prisma.aiFeatureFlag.upsert({
      where: { component },
      create: { component, enabled, updatedBy },
      update: { enabled, updatedBy },
    });
    this.logger.warn("ai.killswitch.admin.set", {
      component,
      enabled,
      updatedBy,
    });
    await this.refreshSnapshot();
    return this.getAllFlags();
  }

  /** Upserts a DB row for every env var that was explicitly set (env = boot default). */
  private async seedFromEnv(): Promise<void> {
    for (const component of ALL_COMPONENTS) {
      const environmentVariable = ENV_VAR_BY_COMPONENT[component];
      if (!isEnvironmentExplicitlySet(environmentVariable)) continue;
      const enabled = !parseEnvironmentFlag(environmentVariable);
      await this.prisma.aiFeatureFlag.upsert({
        where: { component },
        create: { component, enabled, updatedBy: "env:boot" },
        update: { enabled, updatedBy: "env:boot" },
      });
    }
  }

  /** Reloads the in-memory snapshot from the DB (components without a row stay enabled). */
  private async refreshSnapshot(): Promise<void> {
    const rows = await this.prisma.aiFeatureFlag.findMany();
    const next: Record<AiFeatureComponent, boolean> = {
      [AiFeatureComponent.ALL]: true,
      [AiFeatureComponent.GRADING]: true,
      [AiFeatureComponent.CHAT]: true,
      [AiFeatureComponent.AUTHORING]: true,
    };
    for (const row of rows) {
      if (row.component in next) {
        next[row.component as AiFeatureComponent] = row.enabled;
      }
    }
    this.snapshot = next;
  }

  private readEnvAsEnabled(): Record<AiFeatureComponent, boolean> {
    return {
      [AiFeatureComponent.ALL]: !parseEnvironmentFlag(
        ENV_VAR_BY_COMPONENT[AiFeatureComponent.ALL],
      ),
      [AiFeatureComponent.GRADING]: !parseEnvironmentFlag(
        ENV_VAR_BY_COMPONENT[AiFeatureComponent.GRADING],
      ),
      [AiFeatureComponent.CHAT]: !parseEnvironmentFlag(
        ENV_VAR_BY_COMPONENT[AiFeatureComponent.CHAT],
      ),
      [AiFeatureComponent.AUTHORING]: !parseEnvironmentFlag(
        ENV_VAR_BY_COMPONENT[AiFeatureComponent.AUTHORING],
      ),
    };
  }

  private logInitialState(): void {
    const payload = {
      master: this.isDisabled(AiFeatureComponent.ALL),
      grading: this.isDisabled(AiFeatureComponent.GRADING),
      chat: this.isDisabled(AiFeatureComponent.CHAT),
      authoring: this.isDisabled(AiFeatureComponent.AUTHORING),
    };
    const anyDisabled = Object.values(payload).some(Boolean);
    if (anyDisabled) {
      this.logger.warn("ai.killswitch.boot", payload);
    } else {
      this.logger.info("ai.killswitch.boot", payload);
    }
  }
}
