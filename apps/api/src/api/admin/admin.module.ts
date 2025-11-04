import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { PrismaService } from "src/database/prisma.service";
import { EmailService } from "src/common/services/email.service";
import { AdminAuthModule } from "../../auth/admin-auth.module";
import { AuthModule } from "../../auth/auth.module";
import { LlmModule } from "../llm/llm.module";
import { ScheduledTasksModule } from "../scheduled-tasks/scheduled-tasks.module";
import { AdminController } from "./admin.controller";
import { AdminRepository } from "./admin.repository";
import { AdminService } from "./admin.service";
import { AdminDashboardController } from "./controllers/admin-dashboard.controller";
import { AssignmentAnalyticsController } from "./controllers/assignment-analytics.controller";
import { AuthorRegradingRequestsController } from "./controllers/author-regrading-requests.controller";
import { FlaggedSubmissionsController } from "./controllers/flagged-submissions.controller";
import { LLMAssignmentController } from "./controllers/llm-assignment.controller";
import { LLMPricingController } from "./controllers/llm-pricing.controller";
import { RegradingRequestsController } from "./controllers/regrading-requests.controller";
import { SettingsController } from "./controllers/settings.controller";

@Module({
  imports: [
    AuthModule,
    PassportModule,
    AdminAuthModule,
    LlmModule,
    ScheduledTasksModule,
  ],
  controllers: [
    AdminController,
    AdminDashboardController,
    LLMAssignmentController,
    LLMPricingController,
    RegradingRequestsController,
    AuthorRegradingRequestsController,
    FlaggedSubmissionsController,
    AssignmentAnalyticsController,
    SettingsController,
  ],
  providers: [AdminService, PrismaService, AdminRepository, EmailService],
})
export class AdminModule {}
