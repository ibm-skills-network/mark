import { Module } from "@nestjs/common";
import { PrismaService } from "../../prisma.service";
import { LlmService } from "../llm/llm.service";
import { AssignmentController } from "./assignment.controller";
import { AssignmentService } from "./assignment.service";
import { QuestionController } from "./question/question.controller";
import { QuestionService } from "./question/question.service";

@Module({
  controllers: [AssignmentController, QuestionController],
  providers: [AssignmentService, PrismaService, QuestionService, LlmService],
})
export class AssignmentModule {}
