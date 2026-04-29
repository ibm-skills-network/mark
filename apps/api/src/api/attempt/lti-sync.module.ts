import { HttpModule } from "@nestjs/axios";
import { Logger, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { AdminAuthModule } from "../../auth/admin-auth.module";
import { LtiGradeSyncService } from "./services/lti-grade-sync.service";
import { LtiSyncScheduler } from "./schedulers/lti-sync-scheduler";
import { LtiSyncAdminController } from "./controllers/lti-sync-admin.controller";

const DEFAULT_TIMEOUT_SECONDS = 30;

/**
 * Resolves the LTI gateway HTTP timeout (in seconds) from a raw env-var string.
 *
 * Lenient by design: missing, empty, whitespace-only, non-numeric, zero, or
 * negative input falls back to `defaultSeconds`. Invalid input emits a single
 * `logger.warn` (when a logger is supplied) so operators see the misconfiguration
 * at boot, but the module never throws on bad timeout input.
 *
 * Decimal input is floored via `parseInt` (e.g., "60.7" → 60).
 */
export function resolveTimeoutSeconds(
  raw: string | undefined,
  defaultSeconds: number,
  logger?: Logger,
): number {
  if (raw === undefined || raw.trim() === "") return defaultSeconds;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    logger?.warn(
      `GRADING_LTI_GATEWAY_TIMEOUT="${raw}" is invalid; using default ${defaultSeconds}s`,
    );
    return defaultSeconds;
  }
  return parsed;
}

/**
 * Module for LTI grade synchronization functionality.
 * Provides reliable grade syncing with automatic retries and monitoring.
 */
@Module({
  imports: [
    ConfigModule,
    HttpModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const logger = new Logger("LtiSyncModule");
        const seconds = resolveTimeoutSeconds(
          config.get<string>("GRADING_LTI_GATEWAY_TIMEOUT"),
          DEFAULT_TIMEOUT_SECONDS,
          logger,
        );
        logger.log(`LTI gateway HTTP timeout=${seconds}s`);
        return {
          timeout: seconds * 1000,
          maxRedirects: 5,
        };
      },
    }),
    ScheduleModule.forRoot(),
    AdminAuthModule,
  ],
  providers: [
    LtiGradeSyncService,
    {
      provide: "LtiGradeSyncService",
      useClass: LtiGradeSyncService,
    },
    LtiSyncScheduler,
  ],
  controllers: [LtiSyncAdminController],
  exports: [LtiGradeSyncService, "LtiGradeSyncService"],
})
export class LtiSyncModule {}
