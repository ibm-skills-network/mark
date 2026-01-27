import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { PrismaService } from "../../database/prisma.service";
import { AdminService } from "../admin/admin.service";
import { AssignmentModuleV2 } from "../assignment/v2/modules/assignment.module";
import { LlmModule } from "../llm/llm.module";
import { ScheduledTasksService } from "./services/scheduled-tasks.service";

@Module({
  imports: [ScheduleModule.forRoot(), AssignmentModuleV2, LlmModule],
  providers: [ScheduledTasksService, PrismaService, AdminService],
  exports: [ScheduledTasksService],
})
export class ScheduledTasksModule {}
