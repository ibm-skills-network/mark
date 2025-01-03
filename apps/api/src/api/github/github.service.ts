import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import fetch, { Response } from "node-fetch";
import { PrismaService } from "src/prisma.service";

@Injectable()
export class GithubService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly GITHUB_API_URL = "https://api.github.com";

  getOAuthUrl(assignmentId: number, redirectUrl: string): Promise<string> {
    const clientId = process.env.GITHUB_CLIENT_ID;
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
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;

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
      console.error("GitHub Response:", data);
      throw new BadRequestException(
        data.error || "Failed to retrieve GitHub access token",
      );
    }

    if (!data.access_token) {
      console.error("GitHub Token Error:", data);
      throw new BadRequestException(
        data.error || "Access token not returned from GitHub",
      );
    }
    try {
      if (!userId) {
        throw new BadRequestException("User ID is required");
      }
      // check if userCredential exists
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
    } catch (prismaError) {
      console.error("Prisma error:", prismaError);
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

  async listRepositories(token: string): Promise<any[]> {
    const response = await fetch(`${this.GITHUB_API_URL}/user/repos`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!response.ok) {
      interface GitHubErrorResponse {
        message: string;
      }
      const error: GitHubErrorResponse =
        (await response.json()) as GitHubErrorResponse;
      throw new BadRequestException(
        error.message || "Failed to fetch repositories",
      );
    }

    interface Repository {
      id: number;
      name: string;
      full_name: string;
      private: boolean;
    }

    const data: Repository[] = (await response.json()) as Repository[];
    if (!Array.isArray(data)) {
      throw new BadRequestException("Expected an array of repositories");
    }
    return data;
  }

  async getRepositoryContents(
    token: string,
    owner: string,
    repo: string,
    path = "",
  ): Promise<any[]> {
    const url = `${this.GITHUB_API_URL}/repos/${owner}/${repo}/contents/${path}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!response.ok) {
      interface GitHubErrorResponse {
        message: string;
      }
      const error: GitHubErrorResponse =
        (await response.json()) as GitHubErrorResponse;
      throw new BadRequestException(
        error.message || "Failed to fetch repository contents",
      );
    }

    interface RepositoryContent {
      name: string;
      path: string;
      sha: string;
      size: number;
      url: string;
      html_url: string;
      git_url: string;
      download_url: string;
      type: string;
    }

    const data: RepositoryContent[] =
      (await response.json()) as RepositoryContent[];
    if (!Array.isArray(data)) {
      throw new BadRequestException("Expected an array of repository contents");
    }
    return data;
  }
}
