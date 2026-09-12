import { Module } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";
import { GithubCredentialCheckModule } from "../api/github/github-credential-check.module";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

@Module({
  controllers: [HealthController],
  imports: [TerminusModule, GithubCredentialCheckModule],
  providers: [HealthService],
})
export class HealthModule {}
