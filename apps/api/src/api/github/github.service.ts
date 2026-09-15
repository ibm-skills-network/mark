import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { PrismaService } from "src/database/prisma.service";
import { Logger } from "winston";
import {
  GITHUB_OAUTH_ERROR_CODES,
  classifyGithubOauthError,
  githubOauthException,
  isOperatorFault,
} from "./github-oauth-errors";
import { GithubOauthStateService } from "./github-oauth-state.service";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
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
  private readonly logger: Logger;

  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
    private readonly prisma: PrismaService,
    private readonly oauthState: GithubOauthStateService,
  ) {
    this.logger = parentLogger.child({ context: GithubService.name });
  }

  // async so that every rejection reaches the caller as a rejected promise
  // rather than a synchronous throw.
  async getOAuthUrl(
    assignmentId: number,
    redirectUrl: string,
    userId: string,
  ): Promise<string> {
    await Promise.resolve();
    const clientId = this.clientId();
    if (!clientId) {
      this.logger.error("GitHub client id is not configured", {
        stage: "oauth_url",
        user_id: userId,
        assignment_id: assignmentId,
      });
      throw githubOauthException(GITHUB_OAUTH_ERROR_CODES.CONFIGURATION);
    }
    if (!assignmentId) {
      throw new BadRequestException("Assignment ID is required");
    }
    if (!userId) {
      throw new BadRequestException("User ID is required");
    }
    // A handoff that cannot be signed cannot be bound to this session, and an
    // unbound state is the same as no state at all. Stop here rather than hand
    // the browser a parameter that proves nothing.
    if (!this.oauthState.isConfigured()) {
      this.logger.error(
        "GitHub OAuth state secret is not configured, so no handoff can be " +
          "bound to the session that started it",
        {
          stage: "oauth_url",
          user_id: userId,
          assignment_id: assignmentId,
        },
      );
      throw githubOauthException(GITHUB_OAUTH_ERROR_CODES.CONFIGURATION);
    }

    const redirectTarget = this.resolveRedirectTarget(redirectUrl, userId);

    // URLSearchParams encodes every value: interpolating the redirect raw let
    // its own query string swallow the parameters that followed it, and let a
    // caller smuggle extra parameters into the authorize request.
    const parameters = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectTarget,
      scope: "repo",
      state: this.oauthState.issue(userId, assignmentId),
    });

    this.logger.info("Issued a GitHub authorization URL", {
      stage: "oauth_url",
      user_id: userId,
      assignment_id: assignmentId,
    });

    return `${GITHUB_AUTHORIZE_URL}?${parameters.toString()}`;
  }

  async exchangeCodeForToken(
    code: string,
    userId: string,
    state: string | undefined,
  ): Promise<string> {
    if (!userId) {
      throw new BadRequestException("User ID is required");
    }

    // Without key material no state can be checked, so every callback would be
    // refused as an invalid authorization — which blames the learner for an
    // operator fault. Say what it actually is.
    if (!this.oauthState.isConfigured()) {
      this.logger.error(
        "GitHub OAuth state secret is not configured, so no callback can be " +
          "verified",
        { stage: "state_verification", user_id: userId },
      );
      throw githubOauthException(GITHUB_OAUTH_ERROR_CODES.CONFIGURATION);
    }

    // Verify the handoff belongs to this session before spending the code.
    if (!this.oauthState.verify(state, userId)) {
      this.logger.warn(
        "Rejected a GitHub callback that this session did not start",
        {
          stage: "state_verification",
          user_id: userId,
          state_present: Boolean(state),
        },
      );
      throw githubOauthException(
        GITHUB_OAUTH_ERROR_CODES.AUTHORIZATION_INVALID,
      );
    }

    const clientId = this.clientId();
    const clientSecret = this.clientSecret();

    if (!clientId || !clientSecret) {
      this.logger.error("GitHub OAuth credentials are not configured", {
        stage: "token_exchange",
        user_id: userId,
      });
      throw githubOauthException(GITHUB_OAUTH_ERROR_CODES.CONFIGURATION);
    }

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }).toString();

    const { ok, status, data } = await this.requestGithubToken(body, userId);

    if (!ok || !data.access_token) {
      const errorCode = classifyGithubOauthError(data.error);
      const context = {
        stage: "token_exchange",
        user_id: userId,
        github_status: status,
        github_error: data.error,
        error_code: errorCode,
      };
      // A configuration fault is ours and affects every learner, so it is an
      // error; the rest are ordinary, learner-recoverable outcomes.
      if (isOperatorFault(errorCode)) {
        this.logger.error(
          "GitHub rejected the token exchange because of our OAuth configuration",
          context,
        );
      } else {
        this.logger.warn("GitHub rejected the token exchange", context);
      }
      throw githubOauthException(errorCode);
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
      this.logger.error("Failed to persist the GitHub token", {
        stage: "token_persist",
        user_id: userId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw new HttpException(
        "Database error",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    this.logger.info("GitHub token exchange succeeded", {
      stage: "token_exchange",
      user_id: userId,
    });
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
        this.logger.warn("GitHub token exchange transport attempt failed", {
          stage: "token_exchange_transport",
          user_id: userId,
          attempt,
          max_attempts: GITHUB_TOKEN_MAX_ATTEMPTS,
          error: error instanceof Error ? error.message : String(error),
        });
        if (attempt < GITHUB_TOKEN_MAX_ATTEMPTS) {
          await delay(GITHUB_TOKEN_RETRY_DELAY_MS * attempt);
        }
      }
    }

    this.logger.error("GitHub token exchange gave up after repeated failures", {
      stage: "token_exchange_transport",
      user_id: userId,
      max_attempts: GITHUB_TOKEN_MAX_ATTEMPTS,
      error: lastError instanceof Error ? lastError.message : String(lastError),
    });
    throw new HttpException(
      {
        statusCode: HttpStatus.BAD_GATEWAY,
        message: "GitHub sign-in is unavailable.",
        code: GITHUB_OAUTH_ERROR_CODES.UNAVAILABLE,
      },
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

  private clientId(): string | undefined {
    return process.env.NODE_ENV === "development"
      ? process.env.GITHUB_CLIENT_ID_LOCAL
      : process.env.GITHUB_CLIENT_ID;
  }

  private clientSecret(): string | undefined {
    return process.env.NODE_ENV === "development"
      ? process.env.GITHUB_CLIENT_SECRET_LOCAL
      : process.env.GITHUB_CLIENT_SECRET;
  }

  /**
   * The redirect target is browser-supplied, so it is checked against the
   * origins this deployment actually serves before it is handed to GitHub.
   * The rejection is deliberately generic: it never echoes the value back.
   */
  private resolveRedirectTarget(redirectUrl: string, userId: string): string {
    const allowed = this.allowedRedirectOrigins();
    let parsed: URL;
    try {
      parsed = new URL(redirectUrl);
    } catch {
      this.logger.warn("Rejected a GitHub redirect target that is not a URL", {
        stage: "oauth_url",
        user_id: userId,
      });
      throw new BadRequestException("Invalid redirect target");
    }

    if (!allowed.has(parsed.origin)) {
      this.logger.warn("Rejected an off-platform GitHub redirect target", {
        stage: "oauth_url",
        user_id: userId,
        redirect_origin: parsed.origin,
      });
      throw new BadRequestException("Invalid redirect target");
    }

    return parsed.toString();
  }

  private allowedRedirectOrigins(): Set<string> {
    const origins = new Set<string>();
    for (const candidate of [
      process.env.WEB_APP_URL,
      process.env.STAGING_WEB_APP_URL,
    ]) {
      if (!candidate) continue;
      try {
        origins.add(new URL(candidate).origin);
      } catch {
        this.logger.warn("Configured web app URL is not a valid URL", {
          stage: "oauth_url",
        });
      }
    }

    if (process.env.NODE_ENV !== "production") {
      origins.add("http://localhost:3000");
      origins.add("http://localhost:3010");
    }

    if (origins.size === 0) {
      this.logger.error(
        "No web app origin is configured, so every GitHub redirect target is refused",
        { stage: "oauth_url" },
      );
    }

    return origins;
  }
}
