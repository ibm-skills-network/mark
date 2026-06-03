import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { JobQueueModule } from "src/job-queue/job-queue.module";
import { AdminAuthModule } from "../../auth/admin-auth.module";
import { AuthModule } from "../../auth/auth.module";
import { AssignmentModuleV2 } from "../assignment/v2/modules/assignment.module";
import { LlmModule } from "../llm/llm.module";
import { ScheduledTasksModule } from "../scheduled-tasks/scheduled-tasks.module";
import { AdminController } from "./admin.controller";
import { AdminRepository } from "./admin.repository";
import { AdminService } from "./admin.service";
import { AdminDashboardController } from "./controllers/admin-dashboard.controller";
import { AssignmentLevelStandardsController } from "./controllers/assignment-level-standards.controller";
import { AssignmentAnalyticsController } from "./controllers/assignment-analytics.controller";
import { FlaggedSubmissionsController } from "./controllers/flagged-submissions.controller";
import { LLMAssignmentController } from "./controllers/llm-assignment.controller";
import { LLMPricingController } from "./controllers/llm-pricing.controller";
import { QueueStatusController } from "./controllers/queue-status.controller";
import { RegradingRequestsController } from "./controllers/regrading-requests.controller";
import { TranslationMaintenanceController } from "./controllers/translation-maintenance.controller";
import { TRANSLATION_MAINTENANCE_JOB_RUNNER } from "./controllers/translation-maintenance.job-runner";
import { QueueStatusService } from "./services/queue-status.service";

@Module({
  imports: [
    AuthModule,
    PassportModule,
    AdminAuthModule,
    AssignmentModuleV2,
    LlmModule,
    ScheduledTasksModule,
    JobQueueModule,
  ],
  controllers: [
    AdminController,
    AdminDashboardController,
    LLMAssignmentController,
    LLMPricingController,
    RegradingRequestsController,
    FlaggedSubmissionsController,
    AssignmentAnalyticsController,
    AssignmentLevelStandardsController,
    TranslationMaintenanceController,
    QueueStatusController,
  ],
  providers: [
    AdminService,
    AdminRepository,
    QueueStatusService,
    TranslationMaintenanceController,
    {
      provide: TRANSLATION_MAINTENANCE_JOB_RUNNER,
      useExisting: TranslationMaintenanceController,
    },
  ],
  exports: [TRANSLATION_MAINTENANCE_JOB_RUNNER],
})
export class AdminModule {}
