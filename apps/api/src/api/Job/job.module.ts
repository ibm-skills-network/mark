import { HttpModule } from "@nestjs/axios";
import { Module } from "@nestjs/common";
import { JobStatusService } from "./job-status.service";

@Module({
  providers: [JobStatusService],
  exports: [JobStatusService],
  imports: [HttpModule],
})
export class JobModule {}
