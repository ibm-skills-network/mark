import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import fetch, { Response } from "node-fetch";
import { PrismaService } from "src/database/prisma.service";

@Injectable()
export class GithubService {
  constructor(private readonly prisma: PrismaService) {}

  getOAuthUrl(assignmentId: number, redirectUrl: string): Promise<string> {
    const clientId =
      process.env.NODE_ENV === "development"
        ? process.env.GITHUB_CLIENT_ID_LOCAL
        : process.env.GITHUB_CLIENT_ID;
    if (!clientId) {
      throw new BadRequestException("GitHub client ID is missing");
    }
    if (!assignmentId) {
      throw new BadRequestException("Assignment ID is required");
    }
    return Promise.resolve(
      `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUrl}&scope=repo`,
    );
  }
  async exchangeCodeForToken(code: string, userId: string): Promise<string> {
    const clientId =
      process.env.NODE_ENV === "development"
        ? process.env.GITHUB_CLIENT_ID_LOCAL
        : process.env.GITHUB_CLIENT_ID;
    const clientSecret =
      process.env.NODE_ENV === "development"
        ? process.env.GITHUB_CLIENT_SECRET_LOCAL
        : process.env.GITHUB_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new BadRequestException(
        "GitHub client ID or client secret is missing",
      );
    }

    const response: Response = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        }).toString(),
      },
    );

    interface GitHubTokenResponse {
      access_token?: string;
      error?: string;
    }

    const data: GitHubTokenResponse =
      (await response.json()) as GitHubTokenResponse;
    if (!response.ok) {
      throw new BadRequestException(
        data.error || "Failed to retrieve GitHub access token",
      );
    }

    if (!data.access_token) {
      throw new BadRequestException(
        data.error || "Access token not returned from GitHub",
      );
    }
    try {
      if (!userId) {
        throw new BadRequestException("User ID is required");
      }

      const userCredential = await this.prisma.userCredential.findUnique({
        where: {
          userId,
        },
      });
      await (userCredential
        ? this.prisma.userCredential.update({
            where: {
              userId,
            },
            data: {
              githubToken: data.access_token,
            },
          })
        : this.prisma.userCredential.create({
            data: {
              userId,
              githubToken: data.access_token,
            },
          }));
    } catch {
      throw new HttpException(
        "Database error",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return data.access_token;
  }

  async getAccessToken(userId: string): Promise<string> {
    const userCredential = await this.prisma.userCredential.findUnique({
      where: {
        userId,
      },
    });

    if (!userCredential || !userCredential.githubToken) {
      throw new BadRequestException("GitHub token not found");
    }

    return userCredential.githubToken;
  }
}
