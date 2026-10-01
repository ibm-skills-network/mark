/**
 * Client-facing classification of a GitHub OAuth failure.
 *
 * GitHub's own error strings stay server-side: they name our client id/secret
 * state and are useless to a learner. What the browser gets is one of these
 * coarse codes, which is enough for the UI to say something true ("this is our
 * problem" vs "start the connection again") without leaking configuration.
 */
import { HttpException, HttpStatus } from "@nestjs/common";

export const GITHUB_OAUTH_ERROR_CODES = {
  /** Our credentials or app registration are wrong — nothing the learner can do. */
  CONFIGURATION: "github_configuration_error",
  /** The single-use code was already spent, or it aged out. */
  AUTHORIZATION_EXPIRED: "github_authorization_expired",
  /** The handoff could not be tied back to this session. */
  AUTHORIZATION_INVALID: "github_authorization_invalid",
  /** The learner (or an org policy) declined the authorization. */
  ACCESS_DENIED: "github_access_denied",
  /** GitHub answered with something we cannot act on, or not at all. */
  UNAVAILABLE: "github_unavailable",
} as const;

export type GithubOauthErrorCode =
  (typeof GITHUB_OAUTH_ERROR_CODES)[keyof typeof GITHUB_OAUTH_ERROR_CODES];

const CONFIGURATION_ERRORS = new Set([
  "incorrect_client_credentials",
  "invalid_client",
  "unauthorized_client",
  "redirect_uri_mismatch",
  "unsupported_grant_type",
  "invalid_request",
]);

const EXPIRED_ERRORS = new Set([
  "bad_verification_code",
  "expired_token",
  "incorrect_verification_code",
]);

const RESPONSES: Record<
  GithubOauthErrorCode,
  { status: HttpStatus; message: string }
> = {
  [GITHUB_OAUTH_ERROR_CODES.CONFIGURATION]: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: "GitHub sign-in is unavailable.",
  },
  [GITHUB_OAUTH_ERROR_CODES.AUTHORIZATION_EXPIRED]: {
    status: HttpStatus.BAD_REQUEST,
    message: "This GitHub sign-in is no longer valid.",
  },
  [GITHUB_OAUTH_ERROR_CODES.AUTHORIZATION_INVALID]: {
    status: HttpStatus.BAD_REQUEST,
    message: "This GitHub sign-in could not be verified.",
  },
  [GITHUB_OAUTH_ERROR_CODES.ACCESS_DENIED]: {
    status: HttpStatus.BAD_REQUEST,
    message: "GitHub did not grant access.",
  },
  [GITHUB_OAUTH_ERROR_CODES.UNAVAILABLE]: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: "GitHub sign-in is unavailable.",
  },
};

/**
 * Maps a GitHub `error` field onto one of our codes. Unknown values are treated
 * as "unavailable" rather than as the learner's fault.
 */
export function classifyGithubOauthError(
  githubError: string | undefined,
): GithubOauthErrorCode {
  if (!githubError) {
    return GITHUB_OAUTH_ERROR_CODES.UNAVAILABLE;
  }
  if (CONFIGURATION_ERRORS.has(githubError)) {
    return GITHUB_OAUTH_ERROR_CODES.CONFIGURATION;
  }
  if (EXPIRED_ERRORS.has(githubError)) {
    return GITHUB_OAUTH_ERROR_CODES.AUTHORIZATION_EXPIRED;
  }
  if (githubError === "access_denied") {
    return GITHUB_OAUTH_ERROR_CODES.ACCESS_DENIED;
  }
  return GITHUB_OAUTH_ERROR_CODES.UNAVAILABLE;
}

/** True when the code means our configuration is broken for every learner. */
export function isOperatorFault(code: GithubOauthErrorCode): boolean {
  return code === GITHUB_OAUTH_ERROR_CODES.CONFIGURATION;
}

/** Builds the response the browser is allowed to see. */
export function githubOauthException(
  code: GithubOauthErrorCode,
): HttpException {
  const { status, message } = RESPONSES[code];
  return new HttpException({ statusCode: status, message, code }, status);
}
