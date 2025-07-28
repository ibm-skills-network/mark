import { Module } from "@nestjs/common";
import { SharedModule } from "src/shared.module";
import { AdminModule } from "./admin/admin.module";
import { ApiController } from "./api.controller";
import { ApiService } from "./api.service";
import { AssignmentModuleV1 } from "./assignment/v1/modules/assignment.module";
import { AssignmentModuleV2 } from "./assignment/v2/modules/assignment.module";
import { AttemptModule } from "./attempt/attempt.module";
import { FilesModule } from "./files/files.module";
import { GithubModule } from "./github/github.module";
import { JobModule } from "./Job/job.module";
import { LlmModule } from "./llm/llm.module";
import { ReportsModule } from "./report/report.module";
import { ChatModule } from "./user/modules/chat.module";
import { NotificationsModule } from "./user/modules/notification.module";

@Module({
  controllers: [ApiController],
  providers: [ApiService],
  imports: [
    SharedModule,
    LlmModule,
    AssignmentModuleV1,
    AssignmentModuleV2,
    AttemptModule,
    AdminModule,
    GithubModule,
    JobModule,
    ReportsModule,
    ChatModule,
    NotificationsModule,
    FilesModule,
  ],
})
export class ApiModule {}
