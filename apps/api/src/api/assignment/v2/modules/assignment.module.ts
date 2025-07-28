import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";

import { AssignmentControllerV2 } from "../controllers/assignment.controller";

import { QuestionService } from "../services/question.service";
import { AssignmentServiceV2 } from "../services/assignment.service";
import { JobStatusServiceV2 } from "../services/job-status.service";
import { ReportService } from "../services/report.repository";

import { AssignmentRepository } from "../repositories/assignment.repository";
import { QuestionRepository } from "../repositories/question.repository";
import { VariantRepository } from "../repositories/variant.repository";

import { LlmModule } from "src/api/llm/llm.module";
import { PrismaService } from "src/prisma.service";

@Module({
  controllers: [AssignmentControllerV2],
  providers: [
    AssignmentServiceV2,
    QuestionService,
    ReportService,
    JobStatusServiceV2,

    AssignmentRepository,
    QuestionRepository,
    VariantRepository,

    PrismaService,
  ],
  imports: [HttpModule, LlmModule],
  exports: [AssignmentServiceV2, QuestionService, JobStatusServiceV2],
})
export class AssignmentModuleV2 {}
