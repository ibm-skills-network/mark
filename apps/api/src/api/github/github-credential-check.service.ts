/**
 * Boot-time self-check for the GitHub OAuth credential pair.
 *
 * A client id that does not pair with its client secret is invisible from the
 * inside: every route keeps answering, the failure only shows up as a learner's
 * token exchange being rejected. This posts a deliberately invalid code at
 * startup and reads which way GitHub refuses it — `incorrect_client_credentials`
 * means the pair itself is wrong, while `bad_verification_code` means the pair
 * is fine and only the (junk) code was rejected.
 *
 * The result is logged once at boot and served from `/health/integrations`.
 */
import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";

const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const SELF_CHECK_TIMEOUT_MS = 10_000;
const SELF_CHECK_CODE = "mark-startup-credential-probe";

export type GithubCredentialState =
  /** Not probed yet. */
  | "unknown"
  /** No client id/secret in the environment. */
  | "not_configured"
  /** The credential pair is valid; only the junk code was rejected. */
  | "ok"
  /** GitHub says the client id and secret do not belong together. */
  | "misconfigured"
  /** GitHub could not be reached, so nothing was learned. */
  | "unreachable";

export interface GithubCredentialStatus {
  state: GithubCredentialState;
  checkedAt: string | null;
}

const MISPAIRED_ERRORS = new Set([
  "incorrect_client_credentials",
  "invalid_client",
  "unauthorized_client",
]);

@Injectable()
export class GithubCredentialCheckService implements OnModuleInit {
  private readonly logger: Logger;

  private status: GithubCredentialStatus = {
    state: "unknown",
    checkedAt: null,
  };

  constructor(@Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger) {
    this.logger = parentLogger.child({
      context: GithubCredentialCheckService.name,
    });
  }

  onModuleInit(): void {
    // Never block startup on an outbound call, and never let it fail the boot.
    if (process.env.NODE_ENV === "test") {
      return;
    }
    void this.run().catch((error: unknown) => {
      this.logger.warn("GitHub credential self-check could not complete", {
        stage: "credential_self_check",
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  getStatus(): GithubCredentialStatus {
    return this.status;
  }

  async run(): Promise<GithubCredentialStatus> {
    const clientId =
      process.env.NODE_ENV === "development"
        ? process.env.GITHUB_CLIENT_ID_LOCAL
        : process.env.GITHUB_CLIENT_ID;
    const clientSecret =
      process.env.NODE_ENV === "development"
        ? process.env.GITHUB_CLIENT_SECRET_LOCAL
        : process.env.GITHUB_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      this.logger.warn(
        "GitHub OAuth credentials are not configured; the file picker is disabled",
        { stage: "credential_self_check" },
      );
      return this.record("not_configured");
    }

    let githubError: string | undefined;
    let status: number;
    try {
      const response = await fetch(GITHUB_ACCESS_TOKEN_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret, // pragma: allowlist secret (runtime variable)
          code: SELF_CHECK_CODE,
        }).toString(),
        signal: AbortSignal.timeout(SELF_CHECK_TIMEOUT_MS),
      });
      status = response.status;
      const data = (await response.json()) as { error?: string };
      githubError = data.error;
    } catch (error) {
      this.logger.warn("GitHub credential self-check could not reach GitHub", {
        stage: "credential_self_check",
        error: error instanceof Error ? error.message : String(error),
      });
      return this.record("unreachable");
    }

    if (status >= 500 || status === 429) {
      this.logger.warn("GitHub credential self-check was unavailable", {
        stage: "credential_self_check",
        github_status: status,
      });
      return this.record("unreachable");
    }

    if (githubError && MISPAIRED_ERRORS.has(githubError)) {
      this.logger.error(
        "GitHub OAuth credentials are rejected by GitHub: the client id and " +
          "client secret do not belong together, so no learner can connect a " +
          "repository until they are corrected",
        { stage: "credential_self_check", github_error: githubError },
      );
      return this.record("misconfigured");
    }

    if (status !== 200 || githubError !== "bad_verification_code") {
      this.logger.warn(
        "GitHub credential self-check returned an unexpected response",
        {
          stage: "credential_self_check",
          github_status: status,
        },
      );
      return this.record("unreachable");
    }

    this.logger.info("GitHub OAuth credentials accepted by GitHub", {
      stage: "credential_self_check",
      github_error: githubError,
    });
    return this.record("ok");
  }

  private record(state: GithubCredentialState): GithubCredentialStatus {
    this.status = { state, checkedAt: new Date().toISOString() };
    return this.status;
  }
}
