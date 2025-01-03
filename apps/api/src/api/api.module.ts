import { Module } from "@nestjs/common";
import { AdminModule } from "./admin/admin.module";
import { ApiController } from "./api.controller";
import { ApiService } from "./api.service";
import { AssignmentModule } from "./assignment/assignment.module";
import { GithubModule } from "./github/github.module";
import { LlmModule } from "./llm/llm.module";

@Module({
  controllers: [ApiController],
  providers: [ApiService],
  imports: [AssignmentModule, LlmModule, AdminModule, GithubModule],
})
export class ApiModule {}
