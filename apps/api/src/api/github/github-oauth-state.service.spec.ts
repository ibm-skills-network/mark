import "reflect-metadata";

import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { GithubOauthStateService } from "./github-oauth-state.service";

describe("GithubOauthStateService", () => {
  const originalSecret = process.env.GITHUB_CLIENT_SECRET;

  beforeEach(() => {
    process.env.GITHUB_CLIENT_SECRET = "client-secret"; // pragma: allowlist secret
    delete process.env.GITHUB_OAUTH_STATE_SECRET;
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.GITHUB_CLIENT_SECRET;
    } else {
      process.env.GITHUB_CLIENT_SECRET = originalSecret;
    }
    jest.useRealTimers();
  });

  it("accepts a state it issued for the same session", () => {
    const service = new GithubOauthStateService();
    const state = service.issue("learner@example.com", 3601);

    expect(state).not.toContain("learner@example.com");
    expect(service.verify(state, "learner@example.com")).toBe(true);
  });

  it("rejects a state issued for a different learner", () => {
    const service = new GithubOauthStateService();
    const state = service.issue("learner@example.com", 3601);

    expect(service.verify(state, "someone-else@example.com")).toBe(false);
  });

  it("rejects a tampered state", () => {
    const service = new GithubOauthStateService();
    const state = service.issue("learner@example.com", 3601);
    const [payload, signature] = state.split(".");
    const forged = `${payload}x.${signature}`;

    expect(service.verify(forged, "learner@example.com")).toBe(false);
  });

  it("rejects a state that is missing, empty or malformed", () => {
    const service = new GithubOauthStateService();

    expect(service.verify(undefined, "learner@example.com")).toBe(false);
    expect(service.verify("", "learner@example.com")).toBe(false);
    expect(service.verify("no-signature", "learner@example.com")).toBe(false);
  });

  it("rejects a state that has aged out", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-12T10:00:00.000Z"));
    const service = new GithubOauthStateService();
    const state = service.issue("learner@example.com", 3601);

    jest.setSystemTime(new Date("2026-09-12T10:14:00.000Z"));
    expect(service.verify(state, "learner@example.com")).toBe(true);

    jest.setSystemTime(new Date("2026-09-12T10:16:00.000Z"));
    expect(service.verify(state, "learner@example.com")).toBe(false);
  });

  it("rejects a state signed with a different secret", () => {
    const state = new GithubOauthStateService().issue(
      "learner@example.com",
      3601,
    );

    process.env.GITHUB_CLIENT_SECRET = "rotated-secret"; // pragma: allowlist secret
    expect(
      new GithubOauthStateService().verify(state, "learner@example.com"),
    ).toBe(false);
  });

  it("signs the user id and the payload with a separator neither can contain", () => {
    process.env.GITHUB_OAUTH_STATE_SECRET = "state-secret"; // pragma: allowlist secret
    const state = new GithubOauthStateService().issue(
      "learner@example.com",
      3601,
    );
    const [payload, signature] = state.split(".");

    const expected = createHmac(
      "sha256",
      createHash("sha256")
        .update("mark-github-oauth-state:state-secret")
        .digest(),
    )
      .update(`learner@example.com\u0000${payload}`)
      .digest("base64url");

    expect(signature).toBe(expected);
  });
});

describe("GithubOauthStateService without key material", () => {
  const saved = {
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    localClientSecret: process.env.GITHUB_CLIENT_SECRET_LOCAL,
    stateSecret: process.env.GITHUB_OAUTH_STATE_SECRET,
  };

  beforeEach(() => {
    delete process.env.GITHUB_CLIENT_SECRET;
    delete process.env.GITHUB_CLIENT_SECRET_LOCAL;
    delete process.env.GITHUB_OAUTH_STATE_SECRET;
  });

  afterEach(() => {
    const restore = (name: string, value: string | undefined): void => {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    };
    restore("GITHUB_CLIENT_SECRET", saved.clientSecret);
    restore("GITHUB_CLIENT_SECRET_LOCAL", saved.localClientSecret);
    restore("GITHUB_OAUTH_STATE_SECRET", saved.stateSecret);
  });

  it("reports that it cannot sign", () => {
    expect(new GithubOauthStateService().isConfigured()).toBe(false);
  });

  it("refuses to issue a state rather than signing with a derivable key", () => {
    expect(() =>
      new GithubOauthStateService().issue("learner@example.com", 3601),
    ).toThrow(/not configured/i);
  });

  // With no key material the key used to be a constant derived from this file
  // alone, so anyone who knew a victim's user id could mint a state that passed
  // verification — which is the single thing the parameter exists to prevent.
  it("rejects a state forged from the publicly derivable key", () => {
    const derivableKey = createHash("sha256")
      .update("mark-github-oauth-state:")
      .digest();
    const payload = Buffer.from(
      ["forged", "3601", String(Date.now() + 600_000)].join("~"),
    ).toString("base64url");
    const signature = createHmac("sha256", derivableKey)
      .update(`victim@example.com\u0000${payload}`)
      .digest("base64url");

    expect(
      new GithubOauthStateService().verify(
        `${payload}.${signature}`,
        "victim@example.com",
      ),
    ).toBe(false);
  });
});

// The separator was written as a literal 0x00 byte, which makes git classify
// the file as binary: no reviewable diff, and grep skips it entirely. Both the
// service and this spec have to spell it as an escape.
describe("the state files on disk", () => {
  it.each([
    "github-oauth-state.service.ts",
    "github-oauth-state.service.spec.ts",
  ])("%s is a text file", (name) => {
    expect(readFileSync(join(__dirname, name)).includes(0)).toBe(false);
  });
});
