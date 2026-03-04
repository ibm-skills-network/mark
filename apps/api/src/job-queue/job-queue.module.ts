import { Global, Module } from "@nestjs/common";
import { JobStateService } from "./job-state.service";
import { JobQueueService } from "./job-queue.service";

@Global()
@Module({
  providers: [JobQueueService, JobStateService],
  exports: [JobQueueService, JobStateService],
})
export class JobQueueModule {}
