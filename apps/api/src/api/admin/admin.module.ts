import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { PrismaService } from "src/prisma.service";
import { AuthModule } from "../../auth/auth.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { AssignmentAnalyticsController } from "./controllers/assignment-analytics.controller";
import { FlaggedSubmissionsController } from "./controllers/flagged-submissions.controller";
import { RegradingRequestsController } from "./controllers/regrading-requests.controller";
import { AdminRepository } from "./admin.repository";

@Module({
  imports: [AuthModule, PassportModule],
  controllers: [AdminController, RegradingRequestsController, FlaggedSubmissionsController, AssignmentAnalyticsController],
  providers: [AdminService, PrismaService, AdminRepository],
})
export class AdminModule {}
