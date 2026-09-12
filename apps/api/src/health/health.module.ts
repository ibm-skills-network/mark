import { Module } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";
import { GithubCredentialCheckModule } from "../api/github/github-credential-check.module";
import { AdminAuthModule } from "../auth/admin-auth.module";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

@Module({
  controllers: [HealthController],
  // AdminAuthModule supplies the guard on the integration report. The liveness
  // and readiness probes stay open.
  imports: [TerminusModule, GithubCredentialCheckModule, AdminAuthModule],
  providers: [HealthService],
})
export class HealthModule {}
