import { Module } from "@nestjs/common";
import { PrismaService } from "src/database/prisma.service";
import { AdminAuthController } from "./controllers/admin-auth.controller";
import { AdminGuard } from "./guards/admin.guard";
import { AdminEmailService } from "./services/admin-email.service";
import { AdminVerificationService } from "./services/admin-verification.service";

@Module({
  controllers: [AdminAuthController],
  providers: [
    PrismaService,
    AdminVerificationService,
    AdminEmailService,
    AdminGuard,
  ],
  exports: [AdminVerificationService, AdminEmailService, AdminGuard],
})
export class AdminAuthModule {}
