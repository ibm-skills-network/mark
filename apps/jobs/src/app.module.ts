import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { WinstonModule } from "nest-winston";
import { winstonOptions } from "./logger.config";
import { JobWorkerService } from "./job-worker.service";

// Provider source modules (all @Global where applicable, but explicit imports keep intent clear)
import { AiFeatureFlagsModule } from "../../api/src/api/ai-feature-flags/ai-feature-flags.module";
import { DatabaseModule } from "../../api/src/database/database.module";
import { JobQueueModule } from "../../api/src/job-queue/job-queue.module";
import { SharedModule } from "../../api/src/shared.module";
import { AssignmentModuleV1 } from "../../api/src/api/assignment/v1/modules/assignment.module";
import { AssignmentModuleV2 } from "../../api/src/api/assignment/v2/modules/assignment.module";
import { AttemptModule } from "../../api/src/api/attempt/attempt.module";
import { FileProcessingBudgetModule } from "../../api/src/api/files/file-processing-budget.module";

// TranslationMaintenanceController acts as the TRANSLATION_MAINTENANCE_JOB_RUNNER implementation.
// Registered via useClass so we do not need to import the admin module (which pulls cron + HTTP-only deps).
import { TranslationMaintenanceController } from "../../api/src/api/admin/controllers/translation-maintenance.controller";
import { TRANSLATION_MAINTENANCE_JOB_RUNNER } from "../../api/src/api/admin/controllers/translation-maintenance.job-runner";

// JobExecutorService is the entry point for local-execution job dispatch in
// mark-jobs. In the api workspace it is provided by ApiModule (which we
// intentionally do NOT import — ApiModule pulls HTTP routing and global
// guards). Register it here explicitly so the jobs context can construct it
// from the assignment / attempt / translation-runner deps already in scope.
import { JobExecutorService } from "../../api/src/job-queue/job-executor.service";

@Module({
  imports: [
    ConfigModule.forRoot(),
    WinstonModule.forRoot(winstonOptions),
    // Provides AiFeatureFlagsService (required by PromptProcessorService) and
    // GradingKillSwitchService (required by the attempt/assignment services).
    // @Global in the api app, but not inherited into the jobs DI scope — must
    // be imported explicitly here, same as FileProcessingBudgetModule below.
    AiFeatureFlagsModule,
    DatabaseModule,
    JobQueueModule,
    SharedModule,
    AssignmentModuleV1,
    AssignmentModuleV2,
    AttemptModule,
    // FileProcessingBudgetModule is @Global in mark-api's app.module.ts but
    // not inherited into JobsAppModule's DI scope. FilesService (transitive
    // dep of multiple modules above) requires FileProcessingBudgetService;
    // without this import the DI smoke test fails with "Nest can't resolve
    // dependencies of the FilesService".
    FileProcessingBudgetModule,
  ],
  providers: [
    JobWorkerService,
    JobExecutorService,
    {
      provide: TRANSLATION_MAINTENANCE_JOB_RUNNER,
      useClass: TranslationMaintenanceController,
    },
  ],
})
export class JobsAppModule {}
