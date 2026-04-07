import { HttpModule } from "@nestjs/axios";
import { Global, Module } from "@nestjs/common";
import { JobQueueModule } from "./job-queue/job-queue.module";
import { JobStatusServiceV2 } from "./api/assignment/v2/services/job-status.service";
import { TranslationService } from "./api/assignment/v2/services/translation.service";
import { LlmModule } from "./api/llm/llm.module";

@Global()
@Module({
  imports: [HttpModule, LlmModule, JobQueueModule],
  providers: [TranslationService, JobStatusServiceV2],
  exports: [TranslationService, JobStatusServiceV2, HttpModule],
})
export class SharedModule {}
