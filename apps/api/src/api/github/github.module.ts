import { Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { UserThrottlerGuard } from "../files/guards/user-throttler.guard";
import { GithubCredentialCheckModule } from "./github-credential-check.module";
import { GithubOauthStateService } from "./github-oauth-state.service";
import { GithubController } from "./github.controller";
import { GithubService } from "./github.service";

@Module({
  imports: [
    GithubCredentialCheckModule,
    // Infrastructure only — the OAuth routes opt in with
    // @UseGuards(UserThrottlerGuard) + @Throttle. Both of them make an
    // outbound call to github.com on every request.
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 30 }]),
  ],
  controllers: [GithubController],
  providers: [GithubService, GithubOauthStateService, UserThrottlerGuard],
  exports: [GithubService],
})
export class GithubModule {}
