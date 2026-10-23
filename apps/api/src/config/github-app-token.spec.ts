import { createVerify, generateKeyPairSync } from "node:crypto";
import {
  buildGithubAppJwt,
  getGithubAppInstallationToken,
  isGithubAppConfigured,
  resetGithubAppTokenCacheForTests,
} from "./github-app-token";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const PEM = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

const ENV_KEYS = [
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_APP_INSTALLATION_ID",
  "GITHUB_OWNER",
  "GITHUB_REPO",
] as const;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GitHub App installation token", () => {
  const saved: Record<string, string | undefined> = {};
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    process.env.GITHUB_APP_ID = "12345";
    process.env.GITHUB_APP_PRIVATE_KEY = PEM.replaceAll("\n", "\\n"); // pragma: allowlist secret
    delete process.env.GITHUB_APP_INSTALLATION_ID;
    process.env.GITHUB_OWNER = "ibm-skills-network";
    process.env.GITHUB_REPO = "mark-support";
    resetGithubAppTokenCacheForTests();
    fetchMock = jest.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchMock.mockRestore();
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    jest.useRealTimers();
  });

  it("signs an RS256 app JWT the public key verifies", () => {
    const token = buildGithubAppJwt("12345", PEM, Date.UTC(2026, 9, 22));
    const [header, payload, signature] = token.split(".");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${payload}`);
    expect(
      verifier.verify(publicKey, Buffer.from(signature, "base64url")),
    ).toBe(true);
    expect(
      JSON.parse(Buffer.from(payload, "base64url").toString()),
    ).toMatchObject({ iss: "12345" });
  });

  it("is not configured without an app id or a PEM key", async () => {
    delete process.env.GITHUB_APP_ID;
    expect(isGithubAppConfigured()).toBe(false);
    process.env.GITHUB_APP_ID = "12345";
    process.env.GITHUB_APP_PRIVATE_KEY = "not-a-key"; // pragma: allowlist secret
    expect(isGithubAppConfigured()).toBe(false);
    await expect(getGithubAppInstallationToken()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("looks up the installation, mints once and reuses the cached token", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { id: 80_756_668 }))
      .mockResolvedValueOnce(
        jsonResponse(201, {
          token: "ghs_minted", // pragma: allowlist secret
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
      );

    const [a, b] = await Promise.all([
      getGithubAppInstallationToken(),
      getGithubAppInstallationToken(),
    ]);
    const c = await getGithubAppInstallationToken();

    expect([a, b, c]).toEqual(["ghs_minted", "ghs_minted", "ghs_minted"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://api.github.com/repos/ibm-skills-network/mark-support/installation",
    );
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      "https://api.github.com/app/installations/80756668/access_tokens",
    );
  });

  it("uses GITHUB_APP_INSTALLATION_ID without a lookup", async () => {
    process.env.GITHUB_APP_INSTALLATION_ID = "42";
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, {
        token: "ghs_direct", // pragma: allowlist secret
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    );

    await expect(getGithubAppInstallationToken()).resolves.toBe("ghs_direct");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/app/installations/42/access_tokens",
    );
  });

  it("refreshes a token close to expiry", async () => {
    process.env.GITHUB_APP_INSTALLATION_ID = "42";
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(201, {
          token: "ghs_old", // pragma: allowlist secret
          expires_at: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(201, {
          token: "ghs_new", // pragma: allowlist secret
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
      );

    await expect(getGithubAppInstallationToken()).resolves.toBe("ghs_old");
    await expect(getGithubAppInstallationToken()).resolves.toBe("ghs_new");
  });

  it("returns undefined and backs off when minting fails", async () => {
    process.env.GITHUB_APP_INSTALLATION_ID = "42";
    fetchMock.mockResolvedValue(
      jsonResponse(401, { message: "Bad credentials" }),
    );

    await expect(getGithubAppInstallationToken()).resolves.toBeUndefined();
    await expect(getGithubAppInstallationToken()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never hands back an expired token during backoff", async () => {
    process.env.GITHUB_APP_INSTALLATION_ID = "42";
    jest.useFakeTimers({ now: Date.UTC(2026, 9, 22, 12) });
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(201, {
          token: "ghs_short", // pragma: allowlist secret
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
      )
      .mockResolvedValue(jsonResponse(500, {}));

    await expect(getGithubAppInstallationToken()).resolves.toBe("ghs_short");
    jest.setSystemTime(Date.now() + 57 * 60 * 1000); // inside refresh margin
    await expect(getGithubAppInstallationToken()).resolves.toBe("ghs_short");
    jest.setSystemTime(Date.now() + 4 * 60 * 1000); // past expiry, still backing off
    await expect(getGithubAppInstallationToken()).resolves.toBeUndefined();
  });
});
