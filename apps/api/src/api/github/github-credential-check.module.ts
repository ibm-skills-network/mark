import { Module } from "@nestjs/common";
import { GithubCredentialCheckService } from "./github-credential-check.service";

/**
 * Holds the credential self-check on its own so both the GitHub routes and the
 * health endpoint can read the same singleton without the health module pulling
 * in the GitHub controller.
 */
@Module({
  providers: [GithubCredentialCheckService],
  exports: [GithubCredentialCheckService],
})
export class GithubCredentialCheckModule {}
