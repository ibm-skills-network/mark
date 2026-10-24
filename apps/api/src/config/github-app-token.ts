import { createSign } from "node:crypto";
import { Logger } from "@nestjs/common";

/**
 * Installation access token for the Mark GitHub App, used as the server
 * credential for api.github.com reads while grading learner URLs. An
 * installation token can read any public repository, at the app's rate limit
 * instead of the 60 requests/hour/IP an unauthenticated caller gets.
 *
 * Tokens live one hour; we refresh a few minutes early and share one
 * in-flight mint between concurrent callers. A failed mint backs off and
 * returns undefined so grading falls back to unauthenticated requests rather
 * than failing.
 */

const GITHUB_API = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 10_000;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const FAILURE_BACKOFF_MS = 5 * 60 * 1000;

const logger = new Logger("GithubAppToken");

interface CachedToken {
  value: string;
  expiresAtMs: number;
}

let cached: CachedToken | undefined;
let inFlight: Promise<string | undefined> | undefined;
let installationId: number | undefined;
let backoffUntilMs = 0;

function readPrivateKey(): string | undefined {
  let key = process.env.GITHUB_APP_PRIVATE_KEY?.trim();
  if (!key) return undefined;
  if (key.includes("\\n")) key = key.replaceAll("\\n", "\n");
  return key.startsWith("-----BEGIN") ? key : undefined;
}

export function isGithubAppConfigured(): boolean {
  return Boolean(process.env.GITHUB_APP_ID?.trim() && readPrivateKey());
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

export function buildGithubAppJwt(
  appId: string,
  privateKey: string,
  nowMs = Date.now(),
): string {
  const now = Math.floor(nowMs / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: appId }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${base64url(signer.sign(privateKey))}`;
}

async function githubAppRequest<T>(
  path: string,
  appJwt: string,
  method: "GET" | "POST",
): Promise<T> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${appJwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "mark-grading",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`GitHub App ${method} ${path} returned ${response.status}`);
  }
  return (await response.json()) as T;
}

async function resolveInstallationId(appJwt: string): Promise<number> {
  if (installationId) return installationId;
  const explicit = Number(process.env.GITHUB_APP_INSTALLATION_ID);
  if (Number.isInteger(explicit) && explicit > 0) {
    installationId = explicit;
    return installationId;
  }
  const owner = process.env.GITHUB_OWNER?.trim();
  const repo = process.env.GITHUB_REPO?.trim();
  if (!owner || !repo) {
    throw new Error(
      "GITHUB_APP_INSTALLATION_ID or GITHUB_OWNER/GITHUB_REPO is required",
    );
  }
  const data = await githubAppRequest<{ id: number }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/installation`,
    appJwt,
    "GET",
  );
  installationId = data.id;
  return installationId;
}

async function mintToken(): Promise<string | undefined> {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const privateKey = readPrivateKey();
  if (!appId || !privateKey) return undefined;

  try {
    const appJwt = buildGithubAppJwt(appId, privateKey);
    const id = await resolveInstallationId(appJwt);
    const data = await githubAppRequest<{ token: string; expires_at: string }>(
      `/app/installations/${id}/access_tokens`,
      appJwt,
      "POST",
    );
    const expiresAtMs = Date.parse(data.expires_at);
    cached = {
      value: data.token,
      expiresAtMs: Number.isFinite(expiresAtMs)
        ? expiresAtMs
        : Date.now() + 60 * 60 * 1000,
    };
    logger.log("github_app_token.minted", {
      installationId: id,
      expiresAt: data.expires_at,
    });
    return cached.value;
  } catch (error) {
    backoffUntilMs = Date.now() + FAILURE_BACKOFF_MS;
    logger.warn("github_app_token.mint_failed", {
      error: error instanceof Error ? error.message : String(error),
      retryAfterMs: FAILURE_BACKOFF_MS,
    });
    // An early refresh failing must not drop a token that is still valid.
    return cached && cached.expiresAtMs > Date.now() ? cached.value : undefined;
  }
}

export async function getGithubAppInstallationToken(): Promise<
  string | undefined
> {
  if (!isGithubAppConfigured()) return undefined;
  const now = Date.now();
  if (cached && cached.expiresAtMs - REFRESH_MARGIN_MS > now) {
    return cached.value;
  }
  if (now < backoffUntilMs) {
    // Still usable for a few minutes past the refresh margin; never expired.
    return cached && cached.expiresAtMs > now ? cached.value : undefined;
  }
  inFlight ??= mintToken().finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}

/** Test hook: forget cached token, installation id and backoff. */
export function resetGithubAppTokenCacheForTests(): void {
  cached = undefined;
  inFlight = undefined;
  installationId = undefined;
  backoffUntilMs = 0;
}
