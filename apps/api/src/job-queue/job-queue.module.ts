import { Global, Module } from "@nestjs/common";
import { JobWorkerConnectionService } from "./job-worker-connection.service";
import { JobStateService } from "./job-state.service";
import { JobQueueService } from "./job-queue.service";

@Global()
@Module({
  providers: [JobQueueService, JobStateService, JobWorkerConnectionService],
  exports: [JobQueueService, JobStateService, JobWorkerConnectionService],
})
export class JobQueueModule {}
