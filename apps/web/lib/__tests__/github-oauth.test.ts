/**
 * @jest-environment jsdom
 */

import {
  GITHUB_AUTH_MAX_ATTEMPTS,
  clearGithubAuthFailures,
  consumeGithubAuthorizationCode,
  describeGithubAuthFailure,
  exchangeGithubAuthorizationCode,
  readGithubAuthFailureCount,
  recordGithubAuthFailure,
} from "@/lib/github-oauth";

const setUrl = (url: string) => window.history.replaceState({}, "", url);

const jsonResponse = (status: number, body: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }) as Response;

describe("consumeGithubAuthorizationCode", () => {
  beforeEach(() => {
    sessionStorage.clear();
    setUrl("/learner/3601/questions");
  });

  it("returns the code and state and strips them from the address bar", () => {
    setUrl(
      "/learner/3601/questions?code=abc123&state=st-1&iss=https%3A%2F%2Fgithub.com%2Flogin%2Foauth",
    );

    const pending = consumeGithubAuthorizationCode();

    expect(pending).toEqual({ code: "abc123", state: "st-1" });
    expect(window.location.search).toBe("");
  });

  it("keeps unrelated query parameters that the app depends on", () => {
    setUrl("/learner/3601/questions?authorMode=true&code=abc123&state=st-1");

    consumeGithubAuthorizationCode();

    expect(window.location.search).toBe("?authorMode=true");
  });

  // The single-use code was being re-posted 2-6 times per authorization: the
  // modal-open flag is persisted per question, so every remount re-read the
  // code that a failed exchange had left in the URL.
  it("hands out a given code once, even if it reappears in the URL", () => {
    setUrl("/learner/3601/questions?code=abc123&state=st-1");
    expect(consumeGithubAuthorizationCode()).toEqual({
      code: "abc123",
      state: "st-1",
    });

    setUrl("/learner/3601/questions?code=abc123&state=st-1");
    expect(consumeGithubAuthorizationCode()).toBeNull();
    expect(window.location.search).toBe("");
  });

  it("still hands out a genuinely new code", () => {
    setUrl("/learner/3601/questions?code=abc123&state=st-1");
    consumeGithubAuthorizationCode();

    setUrl("/learner/3601/questions?code=def456&state=st-2");
    expect(consumeGithubAuthorizationCode()).toEqual({
      code: "def456",
      state: "st-2",
    });
  });

  it("returns null when there is no code to consume", () => {
    expect(consumeGithubAuthorizationCode()).toBeNull();
  });
});

describe("exchangeGithubAuthorizationCode", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("returns the token on success", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { token: "gho_abc" }));

    await expect(
      exchangeGithubAuthorizationCode("abc", "st-1"),
    ).resolves.toEqual({ token: "gho_abc", failure: null });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      code: "abc",
      state: "st-1",
    });
  });

  it("maps a misconfigured integration to a configuration failure", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(503, {
        code: "github_configuration_error",
        message: "GitHub sign-in is unavailable",
      }),
    );

    await expect(
      exchangeGithubAuthorizationCode("abc", "st-1"),
    ).resolves.toEqual({ token: null, failure: "configuration" });
  });

  it("maps a consumed code to a re-authorization prompt", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { code: "github_authorization_expired" }),
    );

    await expect(
      exchangeGithubAuthorizationCode("abc", "st-1"),
    ).resolves.toEqual({ token: null, failure: "authorization_expired" });
  });

  it("maps a lost Mark session to a session failure, not a GitHub one", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { message: "Unauthorized" }));

    await expect(
      exchangeGithubAuthorizationCode("abc", "st-1"),
    ).resolves.toEqual({ token: null, failure: "session_expired" });
  });

  it("maps a rate-limited or unreachable backend to unavailable", async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, {}));
    await expect(
      exchangeGithubAuthorizationCode("abc", "st-1"),
    ).resolves.toEqual({ token: null, failure: "unavailable" });

    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(
      exchangeGithubAuthorizationCode("abc", "st-1"),
    ).resolves.toEqual({ token: null, failure: "unavailable" });
  });
});

describe("describeGithubAuthFailure", () => {
  // Every failure used to render as "Your GitHub token is invalid or expired."
  // even when no token had ever been issued for the learner.
  it("does not blame an expired token for a misconfigured integration", () => {
    const described = describeGithubAuthFailure("configuration");

    expect(described.message).not.toMatch(/expired/i);
    expect(described.canRetry).toBe(false);
  });

  it("does not blame GitHub when the Mark session is what expired", () => {
    const described = describeGithubAuthFailure("session_expired");

    expect(described.message).toMatch(/session/i);
    expect(described.canRetry).toBe(false);
  });

  it("offers a retry for failures a learner can actually clear", () => {
    expect(describeGithubAuthFailure("authorization_expired").canRetry).toBe(
      true,
    );
    expect(describeGithubAuthFailure("access_denied").canRetry).toBe(true);
    expect(describeGithubAuthFailure("unavailable").canRetry).toBe(true);
  });
});

describe("GitHub authorization failure budget", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("counts failures across the full-page GitHub round trip", () => {
    expect(readGithubAuthFailureCount()).toBe(0);
    expect(recordGithubAuthFailure()).toBe(1);
    expect(recordGithubAuthFailure()).toBe(2);
    expect(readGithubAuthFailureCount()).toBe(2);
  });

  it("clears once a connection succeeds", () => {
    recordGithubAuthFailure();
    clearGithubAuthFailures();

    expect(readGithubAuthFailureCount()).toBe(0);
  });

  it("caps the re-authorize loop at a small number of attempts", () => {
    expect(GITHUB_AUTH_MAX_ATTEMPTS).toBeGreaterThan(1);
    expect(GITHUB_AUTH_MAX_ATTEMPTS).toBeLessThanOrEqual(5);
  });
});
