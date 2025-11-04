import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { EmailService } from "src/common/services/email.service";
import { PrismaService } from "../../database/prisma.service";
import { AdminService } from "../admin/admin.service";
import { LlmModule } from "../llm/llm.module";
import { ScheduledTasksService } from "./services/scheduled-tasks.service";

@Module({
  imports: [ScheduleModule.forRoot(), LlmModule],
  providers: [ScheduledTasksService, PrismaService, AdminService, EmailService],
  exports: [ScheduledTasksService],
})
export class ScheduledTasksModule {}
