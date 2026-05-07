import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { ScheduleModule } from "@nestjs/schedule";
import { AdminAuthModule } from "../../auth/admin-auth.module";
import { LtiGradeSyncService } from "./services/lti-grade-sync.service";
import { LtiSyncScheduler } from "./schedulers/lti-sync-scheduler";
import { LtiSyncAdminController } from "./controllers/lti-sync-admin.controller";

/**
 * Module for LTI grade synchronization functionality.
 * Provides reliable grade syncing with automatic retries and monitoring.
 */
@Module({
  imports: [
    HttpModule.register({
      timeout: 30_000,
      maxRedirects: 5,
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
