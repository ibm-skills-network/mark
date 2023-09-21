import { HttpModule } from "@nestjs/axios";
import { Module } from "@nestjs/common";
import { PrismaService } from "../../prisma.service";
import { LlmService } from "../llm/llm.service";
import { AssignmentController } from "./assignment.controller";
import { AssignmentService } from "./assignment.service";
import { AttemptController } from "./attempt/attempt.controller";
import { AttemptService } from "./attempt/attempt.service";
import { QuestionController } from "./question/question.controller";
import { QuestionService } from "./question/question.service";

@Module({
  controllers: [AssignmentController, QuestionController, AttemptController],
  providers: [
    AssignmentService,
    PrismaService,
    QuestionService,
    LlmService,
    AttemptService,
  ],
  imports: [HttpModule],
})
export class AssignmentModule {}
