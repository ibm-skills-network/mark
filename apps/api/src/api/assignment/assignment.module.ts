import { HttpModule } from "@nestjs/axios";
import { Module } from "@nestjs/common";
import { PrismaService } from "../../prisma.service";
import { LlmService } from "../llm/llm.service";
import { AssignmentController } from "./assignment.controller";
import { AssignmentService } from "./assignment.service";
import { QuestionController } from "./question/question.controller";
import { QuestionService } from "./question/question.service";
import { SubmissionController } from "./submission/submission.controller";
import { SubmissionService } from "./submission/submission.service";

@Module({
  controllers: [AssignmentController, QuestionController, SubmissionController],
  providers: [
    AssignmentService,
    PrismaService,
    QuestionService,
    LlmService,
    SubmissionService,
  ],
  imports: [HttpModule],
})
export class AssignmentModule {}
