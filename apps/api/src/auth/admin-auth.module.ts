import { Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { AdminAuthController } from "./controllers/admin-auth.controller";
import { AdminGuard } from "./guards/admin.guard";
import { AdminEmailService } from "./services/admin-email.service";
import { AdminVerificationService } from "./services/admin-verification.service";

@Module({
  imports: [
    // Per-IP rate limits applied to the admin auth flow. The `strict` tier
    // is opted into via @Throttle on send-code, verify-code, and logout-all
    // — the mutating / cost-bearing endpoints called out in CLAUDE.md. The
    // ThrottlerGuard itself is registered with @UseGuards on the controller
    // (not as APP_GUARD) so it stays scoped to admin auth, not global.
    ThrottlerModule.forRoot([
      { name: "default", ttl: 60_000, limit: 10 },
      { name: "strict", ttl: 60_000, limit: 5 },
    ]),
  ],
  controllers: [AdminAuthController],
  providers: [AdminVerificationService, AdminEmailService, AdminGuard],
  exports: [AdminVerificationService, AdminEmailService, AdminGuard],
})
export class AdminAuthModule {}
