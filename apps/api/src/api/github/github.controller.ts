import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { UserSessionRequest } from "src/auth/interfaces/user.session.interface";
import {
  GithubOauthCallbackDto,
  GithubOauthUrlDto,
} from "./dto/github-oauth.dto";
import { UserThrottlerGuard } from "../files/guards/user-throttler.guard";
import { GithubService } from "./github.service";

// Both OAuth routes mutate state and make an outbound call to github.com on
// every request, so they are capped per learner. A learner needs a handful of
// attempts per minute at most; the observed failure loop produced far more.
const OAUTH_RATE_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@ApiTags("GitHub Integration")
@Controller({
  path: "github",
  version: "1",
})
export class GithubController {
  constructor(private readonly githubService: GithubService) {}

  @Post("oauth-url")
  @UseGuards(UserThrottlerGuard)
  @Throttle(OAUTH_RATE_LIMIT)
  @ApiOperation({ summary: "Get GitHub OAuth URL" })
  @ApiResponse({ status: 200, description: "Returns GitHub OAuth URL" })
  async getOAuthUrl(
    @Body() body: GithubOauthUrlDto,
    @Req() request: UserSessionRequest,
  ): Promise<{ url: string }> {
    const userId = request.userSession?.userId;
    if (!userId) {
      throw new HttpException("User ID is required", HttpStatus.BAD_REQUEST);
    }
    if (!body.assignmentId) {
      throw new HttpException(
        "Assignment ID is required",
        HttpStatus.BAD_REQUEST,
      );
    }
    const url = await this.githubService.getOAuthUrl(
      body.assignmentId,
      body.redirectUrl,
      userId,
    );
    return { url };
  }

  @Post("oauth-callback")
  @UseGuards(UserThrottlerGuard)
  @Throttle(OAUTH_RATE_LIMIT)
  @ApiOperation({ summary: "Handle GitHub OAuth callback" })
  @ApiResponse({ status: 200, description: "GitHub authentication successful" })
  async handleOAuthCallback(
    @Body() body: GithubOauthCallbackDto,
    @Req() request: UserSessionRequest,
  ): Promise<{ token: string; message: string }> {
    const userId = request.userSession?.userId;
    if (userId === undefined) {
      throw new HttpException("User ID is required", HttpStatus.BAD_REQUEST);
    }
    if (!body.code) {
      throw new HttpException(
        "Authorization code is required",
        HttpStatus.BAD_REQUEST,
      );
    }

    const token = await this.githubService.exchangeCodeForToken(
      body.code,
      userId,
      body.state,
    );

    return {
      token,
      message: "GitHub authentication successful",
    };
  }

  @Get("github_token")
  @ApiOperation({ summary: "Get GitHub token" })
  @ApiResponse({ status: 200, description: "Returns GitHub token" })
  getGithubToken(@Req() request: UserSessionRequest): Promise<string> {
    const userId = request.userSession?.userId;
    if (userId === undefined) {
      throw new HttpException("User ID is required", HttpStatus.BAD_REQUEST);
    }
    return this.githubService.getAccessToken(userId);
  }
}
