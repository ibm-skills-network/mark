import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "src/database/prisma.service";

const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";

// Uses the platform's native fetch (Node's global fetch / undici) rather than
// node-fetch v2: inside the service mesh, node-fetch v2 fails every request to
// github.com with "Premature close", while native fetch is reliable.
//
// The endpoint can still drop a connection mid-response, which is a transient
// transport failure rather than a real rejection — so bound each call with a
// timeout and retry the transport a few times before giving up.
const GITHUB_TOKEN_TIMEOUT_MS = 10_000;
const GITHUB_TOKEN_MAX_ATTEMPTS = 3;
const GITHUB_TOKEN_RETRY_DELAY_MS = 250;

interface GitHubTokenResponse {
  access_token?: string;
  error?: string;
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name);

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

    if (!userId) {
      throw new BadRequestException("User ID is required");
    }

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }).toString();

    const { ok, data } = await this.requestGithubToken(body, userId);

    if (!ok) {
      this.logger.warn(
        `GitHub rejected token exchange for ${userId}: ${data.error ?? "unknown error"}`,
      );
      throw new BadRequestException(
        data.error || "Failed to retrieve GitHub access token",
      );
    }

    if (!data.access_token) {
      this.logger.warn(
        `GitHub returned no access token for ${userId}: ${data.error ?? "no error provided"}`,
      );
      throw new BadRequestException(
        data.error || "Access token not returned from GitHub",
      );
    }

    try {
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
    } catch (error) {
      this.logger.error(
        `Failed to persist GitHub token for ${userId}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new HttpException(
        "Database error",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    this.logger.log(`GitHub token exchange succeeded for ${userId}`);
    return data.access_token;
  }

  /**
   * Performs the GitHub token exchange with a timeout and bounded retries.
   *
   * A thrown error (network reset, "Premature close", timeout, non-JSON body)
   * is treated as a transient transport failure and retried. A parsed response
   * — even one carrying a GitHub `error` — is returned as-is and never retried,
   * because the single-use OAuth `code` has already been consumed by then.
   */
  private async requestGithubToken(
    body: string,
    userId: string,
  ): Promise<{ ok: boolean; status: number; data: GitHubTokenResponse }> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= GITHUB_TOKEN_MAX_ATTEMPTS; attempt++) {
      try {
        const response = await fetch(GITHUB_ACCESS_TOKEN_URL, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
          signal: AbortSignal.timeout(GITHUB_TOKEN_TIMEOUT_MS),
        });
        const data = (await response.json()) as GitHubTokenResponse;
        return { ok: response.ok, status: response.status, data };
      } catch (error) {
        lastError = error;
        const message =
          error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `GitHub token exchange attempt ${attempt}/${GITHUB_TOKEN_MAX_ATTEMPTS} ` +
            `failed for ${userId}: ${message}`,
        );
        if (attempt < GITHUB_TOKEN_MAX_ATTEMPTS) {
          await delay(GITHUB_TOKEN_RETRY_DELAY_MS * attempt);
        }
      }
    }

    const message =
      lastError instanceof Error ? lastError.message : String(lastError);
    this.logger.error(
      `GitHub token exchange failed for ${userId} after ` +
        `${GITHUB_TOKEN_MAX_ATTEMPTS} attempts: ${message}`,
    );
    throw new HttpException(
      "GitHub authentication is temporarily unavailable. Please try again.",
      HttpStatus.BAD_GATEWAY,
    );
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
