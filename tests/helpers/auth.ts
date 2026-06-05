/**
 * Auth minting helpers for Playwright E2E.
 *
 * The gateway authenticates browser traffic with an HS256 JWT carried in the
 * `authentication` cookie (apps/api-gateway/.../jwt.cookie.strategy.ts):
 *   - secret:           process.env.SECRET || "devsecret" // pragma: allowlist secret
 *   - ignoreExpiration: false  -> expired tokens are rejected (401)
 *   - payload claims:   userID (an EMAIL), role, groupID, assignmentID,
 *                       gradingCallbackRequired, returnUrl,
 *                       launch_presentation_locale, iat, exp
 *
 * These helpers let a spec authenticate as an ARBITRARY identity, and also
 * construct deliberately invalid tokens (expired / forged signature) for
 * negative-auth tests. The JWT signing itself lives in `./jwt.ts` — shared with
 * the LTI helper so the two cannot drift.
 */
import type { BrowserContext } from "@playwright/test";
import {
  getTestEnvironmentConfig,
  type TestEnvironmentConfig,
} from "./assignment-helpers";
import {
  AUTH_COOKIE_NAME,
  DEFAULT_EXPIRES_IN_SECONDS,
  DEFAULT_LOCALE,
  DEFAULT_RETURN_URL,
  buildAuthStorageState,
  signAuthJwt,
  type StorageState,
  type StorageStateCookie,
} from "./jwt";

export type AuthRole = "author" | "learner";

export type MintAuthOptions = {
  /** Identity (an email — User.userId is an email across the schema). */
  userId: string;
  role: AuthRole;
  groupId?: string;
  assignmentId?: number;
  /**
   * Token lifetime in seconds from now. Use a NEGATIVE value to mint an
   * already-expired token for negative-auth tests. Default: 6 hours.
   */
  expiresInSeconds?: number;
  /**
   * When provided, the token is signed with THIS secret instead of the real
   * one — producing a signature the gateway will reject. Use for forged-token
   * negative-auth tests.
   */
  forgeWithSecret?: string;
  /** Override the configured environment (rarely needed). */
  config?: TestEnvironmentConfig;
};

export type { StorageState, StorageStateCookie };

type JwtPayload = {
  userID: string;
  role: AuthRole;
  assignmentID: number;
  groupID: string;
  gradingCallbackRequired: false;
  returnUrl: string;
  launch_presentation_locale: string;
  iat: number;
  exp: number;
};

/**
 * Mint a signed `authentication` JWT for an arbitrary identity.
 *
 * @returns the raw token string and its `exp` (unix seconds).
 */
export function mintAuthToken(options: MintAuthOptions): {
  token: string;
  expiresAt: number;
} {
  const config = options.config ?? getTestEnvironmentConfig();
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt =
    issuedAt + (options.expiresInSeconds ?? DEFAULT_EXPIRES_IN_SECONDS);

  const payload: JwtPayload = {
    userID: options.userId,
    role: options.role,
    assignmentID: options.assignmentId ?? 0,
    groupID: options.groupId ?? config.groupId,
    gradingCallbackRequired: false,
    returnUrl: DEFAULT_RETURN_URL,
    launch_presentation_locale: DEFAULT_LOCALE,
    iat: issuedAt,
    exp: expiresAt,
  };

  const signingSecret = options.forgeWithSecret ?? config.jwtSecret; // pragma: allowlist secret
  return {
    token: signAuthJwt(payload, signingSecret),
    expiresAt,
  };
}

/**
 * Mint a Playwright `storageState` object containing the `authentication`
 * cookie for an arbitrary identity. Pass this to `browser.newContext({ storageState })`
 * or write it to disk for a project's `storageState` config.
 */
export function mintAuthCookie(options: MintAuthOptions): StorageState {
  const config = options.config ?? getTestEnvironmentConfig();
  const { token, expiresAt } = mintAuthToken(options);
  const { hostname } = new URL(config.webBaseUrl);
  return buildAuthStorageState({ token, expiresAt, hostname });
}

/**
 * Attach a freshly-minted `authentication` cookie to an existing browser
 * context (e.g. one created with `browser.newContext()`), replacing whatever
 * the project's default storageState set. Returns the token for assertions.
 *
 * Note: when a project already configures `storageState` (author/learner),
 * call this to OVERRIDE the identity for a single context — handy for authz
 * tests that need a different user than the project default.
 */
export async function attachAuthCookie(
  context: BrowserContext,
  options: MintAuthOptions,
): Promise<{ token: string; expiresAt: number }> {
  const config = options.config ?? getTestEnvironmentConfig();
  const { token, expiresAt } = mintAuthToken(options);
  const { hostname } = new URL(config.webBaseUrl);

  await context.clearCookies({ name: AUTH_COOKIE_NAME });
  await context.addCookies([
    {
      name: AUTH_COOKIE_NAME,
      value: token,
      domain: hostname,
      path: "/",
      expires: expiresAt,
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  return { token, expiresAt };
}

/**
 * Convenience builders for the common negative-auth fixtures.
 */
export const negativeAuth = {
  /** An already-expired (but correctly-signed) token. */
  expired(options: Omit<MintAuthOptions, "expiresInSeconds">): StorageState {
    return mintAuthCookie({ ...options, expiresInSeconds: -60 });
  },
  /** A token signed with the wrong secret (bad signature). */
  forged(options: Omit<MintAuthOptions, "forgeWithSecret">): StorageState {
    return mintAuthCookie({
      ...options,
      forgeWithSecret: "not-the-real-secret", // pragma: allowlist secret
    });
  },
};
