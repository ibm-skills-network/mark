import { HttpModule } from "@nestjs/axios";
import { Global, Module } from "@nestjs/common";
import { JobQueueModule } from "./job-queue/job-queue.module";
import { AssignmentRepository } from "./api/assignment/v2/repositories/assignment.repository";
import { JobStatusServiceV2 } from "./api/assignment/v2/services/job-status.service";
import { TranslationService } from "./api/assignment/v2/services/translation.service";
import { LlmModule } from "./api/llm/llm.module";

@Global()
@Module({
  imports: [HttpModule, LlmModule, JobQueueModule],
  // AssignmentRepository is provided here rather than imported from
  // AssignmentModuleV2: this module is @Global and AssignmentModuleV2 already
  // depends on what it exports, so importing it back would close a cycle. The
  // repository only needs PrismaService (itself global), and holds no state, so
  // a second instance costs nothing.
  providers: [TranslationService, JobStatusServiceV2, AssignmentRepository],
  exports: [TranslationService, JobStatusServiceV2, HttpModule],
})
export class SharedModule {}
