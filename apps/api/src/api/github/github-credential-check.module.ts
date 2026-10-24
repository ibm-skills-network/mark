import { Module } from "@nestjs/common";
import { GithubCredentialCheckService } from "./github-credential-check.service";

/**
 * The GitHub OAuth credential self-check read by the health endpoint. No route
 * uses the OAuth credentials any more.
 */
@Module({
  providers: [GithubCredentialCheckService],
  exports: [GithubCredentialCheckService],
})
export class GithubCredentialCheckModule {}
