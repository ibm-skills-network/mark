/**
 * @jest-environment jsdom
 */

import {
  GITHUB_AUTH_MAX_ATTEMPTS,
  clearGithubAuthFailures,
  consumeGithubAuthorizationCode,
  describeGithubAuthFailure,
  exchangeGithubAuthorizationCode,
  isGithubExchangeInFlight,
  readGithubAuthFailureCount,
  recordGithubAuthFailure,
  resetGithubHandoffForTesting,
  wasGithubAuthorizationConsumed,
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

    expect(pending).toEqual({ code: "abc123", state: "st-1", denial: null });
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
      denial: null,
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
      denial: null,
    });
  });

  it("returns null when there is no code to consume", () => {
    expect(consumeGithubAuthorizationCode()).toBeNull();
  });

  // Clicking "Cancel" on GitHub's consent screen returns an error and no code.
  // Leaving those parameters in the address bar baked them into the next
  // redirect_uri and left the learner going round the same loop.
  it("strips GitHub's refusal from the address bar and reports it", () => {
    setUrl(
      "/learner/3601/questions?error=access_denied" +
        "&error_description=The+user+has+denied+your+application+access" +
        "&error_uri=https%3A%2F%2Fdocs.github.com%2Foauth&state=st-1",
    );

    expect(consumeGithubAuthorizationCode()).toEqual({
      code: null,
      state: "st-1",
      denial: "access_denied",
    });
    expect(window.location.search).toBe("");
  });

  it("keeps unrelated parameters when it strips a refusal", () => {
    setUrl("/learner/3601/questions?authorMode=true&error=access_denied");

    consumeGithubAuthorizationCode();

    expect(window.location.search).toBe("?authorMode=true");
  });

  // Everything GitHub can return here other than access_denied is an
  // application-configuration fault, not something the learner can clear.
  it("reports any other authorize error as a configuration fault", () => {
    setUrl("/learner/3601/questions?error=redirect_uri_mismatch");

    expect(consumeGithubAuthorizationCode()).toEqual({
      code: null,
      state: null,
      denial: "configuration",
    });
  });

  it("reports a code as a code, with no denial", () => {
    setUrl("/learner/3601/questions?code=abc123&state=st-1");

    expect(consumeGithubAuthorizationCode()).toEqual({
      code: "abc123",
      state: "st-1",
      denial: null,
    });
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

// A submission with two or more GitHub answers renders one component per
// question, and each ran the same bootstrap. Whichever one lost the race for
// the code used to navigate the whole page to github.com, killing the exchange
// the winner was still awaiting.
describe("one authorization handoff per page load", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    sessionStorage.clear();
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    setUrl("/learner/3601/questions");
    resetGithubHandoffForTesting();
  });

  it("reports no handoff on a page that GitHub did not redirect to", () => {
    expect(isGithubExchangeInFlight()).toBe(false);
    expect(wasGithubAuthorizationConsumed()).toBe(false);
  });

  it("stays flagged for the rest of the page load once a code is consumed", () => {
    setUrl("/learner/3601/questions?code=abc123&state=st-1");
    consumeGithubAuthorizationCode();

    expect(wasGithubAuthorizationConsumed()).toBe(true);
    // A second reader gets nothing, and still sees that the handoff is owned.
    expect(consumeGithubAuthorizationCode()).toBeNull();
    expect(wasGithubAuthorizationConsumed()).toBe(true);
  });

  it("flags a consumed refusal too", () => {
    setUrl("/learner/3601/questions?error=access_denied");
    consumeGithubAuthorizationCode();

    expect(wasGithubAuthorizationConsumed()).toBe(true);
  });

  it("reports an exchange as in flight until it settles", async () => {
    let settle: (value: Response) => void = () => undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          settle = resolve;
        }),
    );

    const exchange = exchangeGithubAuthorizationCode("abc", "st-1");
    expect(isGithubExchangeInFlight()).toBe(true);

    settle(jsonResponse(200, { token: "gho_abc" }));
    await exchange;

    expect(isGithubExchangeInFlight()).toBe(false);
  });

  it("stops reporting an exchange as in flight when it fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    await exchangeGithubAuthorizationCode("abc", "st-1");

    expect(isGithubExchangeInFlight()).toBe(false);
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
