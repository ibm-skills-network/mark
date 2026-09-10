/**
 * Shared HS256 JWT signing for the gateway `authentication` cookie.
 *
 * The gateway accepts an HS256 JWT in the `authentication` cookie
 * (apps/api-gateway/.../jwt.cookie.strategy.ts, // pragma: allowlist secret
 * secret = `process.env.SECRET || "devsecret"`). // pragma: allowlist secret
 *
 * Both the auth-test helper (`./auth.ts`) and the LTI helper
 * (`./lti/mock-lti.ts`) need to mint these tokens. They previously each
 * reimplemented base64url + HMAC signing; this module is the single source of
 * truth so the two cannot drift (e.g. when a new claim is added).
 */
import { createHmac } from "node:crypto";

export const AUTH_COOKIE_NAME = "authentication"; // pragma: allowlist secret
export const DEFAULT_RETURN_URL = "https://skills.network";
export const DEFAULT_LOCALE = "en";
export const DEFAULT_EXPIRES_IN_SECONDS = 6 * 60 * 60;

export type StorageStateCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Lax" | "Strict" | "None";
};

export type StorageState = {
  cookies: StorageStateCookie[];
  origins: never[];
};

function base64UrlEncode(value: string): string {
  return Buffer.from(value).toString("base64url");
}

/**
 * Sign an HS256 JWT for an arbitrary payload. Callers own the payload shape;
 * the gateway only validates the signature + `exp` (when present).
 */
export function signAuthJwt(
  payload: Record<string, unknown>,
  secret: string,
): string {
  const encodedHeader = base64UrlEncode(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  );
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * Build the single-cookie storageState carrying the `authentication` JWT.
 * Used by both the auth helper and the LTI helper.
 */
export function buildAuthStorageState(options: {
  token: string;
  expiresAt: number;
  hostname: string;
}): StorageState {
  return {
    cookies: [
      {
        name: AUTH_COOKIE_NAME,
        value: options.token,
        domain: options.hostname,
        path: "/",
        expires: options.expiresAt,
        httpOnly: false,
        secure: false,
        sameSite: "Lax",
      },
    ],
    origins: [],
  };
}
