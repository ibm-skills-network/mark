import { HttpModule } from "@nestjs/axios";
import { Module } from "@nestjs/common";
import { JobQueueModule } from "src/job-queue/job-queue.module";
import { JobStatusServiceV1 } from "./job-status.service";

@Module({
  providers: [JobStatusServiceV1],
  exports: [JobStatusServiceV1],
  imports: [HttpModule, JobQueueModule],
})
export class JobModule {}
