import { HttpModule } from "@nestjs/axios";
import { Module } from "@nestjs/common";
import { AdminService } from "src/api/admin/admin.service";
import { LlmModule } from "src/api/llm/llm.module";
import { AdminVerificationService } from "src/auth/services/admin-verification.service";
import { PrismaService } from "src/prisma.service";
import { AssignmentControllerV2 } from "../controllers/assignment.controller";
import { DraftManagementController } from "../controllers/draft-management.controller";
import { VersionManagementController } from "../controllers/version-management.controller";
import { AssignmentRepository } from "../repositories/assignment.repository";
import { QuestionRepository } from "../repositories/question.repository";
import { VariantRepository } from "../repositories/variant.repository";
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
    QuestionService,
    ReportService,
    JobStatusServiceV2,

    AssignmentRepository,
    QuestionRepository,
    VariantRepository,
    AdminVerificationService,
    PrismaService,
    AdminService,
  ],
  imports: [HttpModule, LlmModule],
  exports: [
    AssignmentServiceV2,
    VersionManagementService,
    DraftManagementService,
    QuestionService,
    JobStatusServiceV2,
  ],
})
export class AssignmentModuleV2 {}
