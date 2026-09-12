import "reflect-metadata";

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
});
