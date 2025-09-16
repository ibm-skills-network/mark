import { HttpModule } from "@nestjs/axios";
import { Module } from "@nestjs/common";
import { JobStatusServiceV1 } from "src/api/Job/job-status.service";
import { LlmModule } from "../../../llm/llm.module";
import { AttemptControllerV1 } from "../../attempt/attempt.controller";
import { AttemptServiceV1 } from "../../attempt/attempt.service";
import { QuestionController } from "../../question/question.controller";
import { QuestionService } from "../../question/question.service";
import { AssignmentControllerV1 } from "../controllers/assignment.controller";
import { AssignmentServiceV1 } from "../services/assignment.service";

@Module({
  controllers: [
    AssignmentControllerV1,
    QuestionController,
    AttemptControllerV1,
  ],
  providers: [
    AssignmentServiceV1,
    QuestionService,
    JobStatusServiceV1,
    AttemptServiceV1,
  ],
  imports: [HttpModule, LlmModule],
  exports: [QuestionService, JobStatusServiceV1],
})
export class AssignmentModuleV1 {}
