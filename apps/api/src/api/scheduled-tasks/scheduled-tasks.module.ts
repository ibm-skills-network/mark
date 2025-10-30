import { Module, forwardRef } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { PrismaService } from "../../database/prisma.service";
import { AdminModule } from "../admin/admin.module";
import { LlmModule } from "../llm/llm.module";
import { ScheduledTasksService } from "./services/scheduled-tasks.service";

@Module({
  imports: [ScheduleModule.forRoot(), LlmModule, forwardRef(() => AdminModule)],
  providers: [ScheduledTasksService, PrismaService],
  exports: [ScheduledTasksService],
})
export class ScheduledTasksModule {}
