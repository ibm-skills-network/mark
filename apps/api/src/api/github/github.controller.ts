import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Req,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { UserSessionRequest } from "src/auth/interfaces/user.session.interface";
import { GithubService } from "./github.service";

@ApiTags("GitHub Integration")
@Controller({
  path: "github",
  version: "1",
})
export class GithubController {
  constructor(private readonly githubService: GithubService) {}

  @Post("oauth-url")
  @ApiOperation({ summary: "Get GitHub OAuth URL" })
  @ApiResponse({ status: 200, description: "Returns GitHub OAuth URL" })
  async getOAuthUrl(
    @Body() body: { assignmentId: number; redirectUrl: string },
  ): Promise<{ url: string }> {
    if (!body.assignmentId) {
      throw new HttpException(
        "Assignment ID is required",
        HttpStatus.BAD_REQUEST,
      );
    }
    const url = await this.githubService.getOAuthUrl(
      body.assignmentId,
      body.redirectUrl,
    );
    return { url };
  }

  @Post("oauth-callback")
  @ApiOperation({ summary: "Handle GitHub OAuth callback" })
  @ApiResponse({ status: 200, description: "GitHub authentication successful" })
  async handleOAuthCallback(
    @Body("code") code: string,
    @Req() request: UserSessionRequest,
  ): Promise<{ token: string; message: string }> {
    const userId = request.userSession.userId;
    if (userId === undefined) {
      throw new HttpException("User ID is required", HttpStatus.BAD_REQUEST);
    }
    if (!code) {
      throw new HttpException(
        "Authorization code is required",
        HttpStatus.BAD_REQUEST,
      );
    }

    const token = await this.githubService.exchangeCodeForToken(code, userId);

    return {
      token,
      message: "GitHub authentication successful",
    };
  }

  @Get("github_token")
  @ApiOperation({ summary: "Get GitHub token" })
  @ApiResponse({ status: 200, description: "Returns GitHub token" })
  getGithubToken(@Req() request: UserSessionRequest): Promise<string> {
    const userId = request.userSession.userId;
    if (userId === undefined) {
      throw new HttpException("User ID is required", HttpStatus.BAD_REQUEST);
    }
    return this.githubService.getAccessToken(userId);
  }
}
