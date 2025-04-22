import { Module } from "@nestjs/common";
import { AdminModule } from "./admin/admin.module";
import { ApiController } from "./api.controller";
import { ApiService } from "./api.service";
import { AssignmentModule } from "./assignment/assignment.module";
import { GithubModule } from "./github/github.module";
import { JobModule } from "./Job/job.module";
import { LlmModule } from "./llm/llm.module";
import { ReportsModule } from "./report/report.module";

@Module({
  controllers: [ApiController],
  providers: [ApiService],
  imports: [
    AssignmentModule,
    LlmModule,
    AdminModule,
    GithubModule,
    JobModule,
    ReportsModule,
  ],
})
export class ApiModule {}
