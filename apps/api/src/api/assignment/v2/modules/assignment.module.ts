import { HttpModule } from "@nestjs/axios";
import { Module } from "@nestjs/common";
import { AdminService } from "src/api/admin/admin.service";
import { AttemptAccessCacheModule } from "src/api/attempt/services/attempt-access-cache.module";
import { FileContentExtractionService } from "src/api/attempt/services/file-content-extraction";
import { PdfStructureExtractorService } from "src/api/attempt/services/pdf-structure-extractor.service";
import { FilesModule } from "src/api/files/files.module";
import { LlmModule } from "src/api/llm/llm.module";
import { AdminVerificationService } from "src/auth/services/admin-verification.service";
import { JobQueueModule } from "src/job-queue/job-queue.module";
import { AssignmentControllerV2 } from "../controllers/assignment.controller";
import { DraftManagementController } from "../controllers/draft-management.controller";
import { VersionManagementController } from "../controllers/version-management.controller";
import { AssignmentRepository } from "../repositories/assignment.repository";
import { QuestionRepository } from "../repositories/question.repository";
import { VariantRepository } from "../repositories/variant.repository";
import { AssignmentFileService } from "../services/assignment-file.service";
import { AssignmentServiceV2 } from "../services/assignment.service";
import { DraftManagementService } from "../services/draft-management.service";
import { JobStatusServiceV2 } from "../services/job-status.service";
import { QuestionService } from "../services/question.service";
import { ReportService } from "../services/report.repository";
import { VersionManagementService } from "../services/version-management.service";

@Module({
  controllers: [
    AssignmentControllerV2,
    VersionManagementController,
    DraftManagementController,
  ],
  providers: [
    AssignmentServiceV2,
    VersionManagementService,
    DraftManagementService,
    AssignmentFileService,
    QuestionService,
    ReportService,
    JobStatusServiceV2,
    FileContentExtractionService,
    PdfStructureExtractorService,

    AssignmentRepository,
    QuestionRepository,
    VariantRepository,
    AdminVerificationService,
    AdminService,
  ],
  imports: [
    HttpModule,
    LlmModule,
    JobQueueModule,
    FilesModule,
    AttemptAccessCacheModule,
  ],
  exports: [
    AssignmentServiceV2,
    VersionManagementService,
    DraftManagementService,
    AssignmentFileService,
    QuestionService,
    JobStatusServiceV2,
  ],
})
export class AssignmentModuleV2 {}
