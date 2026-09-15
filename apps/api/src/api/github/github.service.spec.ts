import "reflect-metadata";
import { HttpException, HttpStatus } from "@nestjs/common";
import type { Logger as WinstonLogger } from "winston";

import { GITHUB_OAUTH_ERROR_CODES } from "./github-oauth-errors";
import { GithubOauthStateService } from "./github-oauth-state.service";
import { GithubService } from "./github.service";

// The service uses the platform's native global fetch on purpose: node-fetch v2
// fails against github.com from inside the service mesh ("Premature close"),
// while native fetch works. Mock the global so we drive the transport here.
let mockedFetch: jest.SpyInstance;

const prisma = {
  userCredential: {
    findUnique: jest.fn(),
    create: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
  },
};

const logged = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
const winston = { child: jest.fn(() => logged) } as unknown as WinstonLogger;

const LEARNER = "user@example.com";
const ASSIGNMENT = 3601;
const REDIRECT = "https://mark.staging.skills.network/learner/3601/questions";
const CALLBACK = "https://mark.staging.skills.network/api/github/callback";

let stateService: GithubOauthStateService;

const make = () => new GithubService(winston, prisma as never, stateService);

// A fetch Response whose body parses cleanly (partial mock — only what the
// service touches).
const jsonResponse = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  }) as unknown as Response;

// Reproduces the production symptom: the connection drops while the body is
// being read, so response.json() rejects with a "Premature close".
const prematureCloseResponse = () =>
  ({
    ok: true,
    status: 200,
    json: jest
      .fn()
      .mockRejectedValue(
        Object.assign(
          new Error(
            "Invalid response body while trying to fetch " +
              "https://github.com/login/oauth/access_token: Premature close",
          ),
          { name: "FetchError", type: "system" },
        ),
      ),
  }) as unknown as Response;

const bodyOf = (error: unknown): Record<string, unknown> =>
  (error as HttpException).getResponse() as Record<string, unknown>;

describe("GithubService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Fresh spy on the global fetch each test; restoreAllMocks (afterEach) puts
    // the real one back so nothing leaks between tests.
    mockedFetch = jest.spyOn(globalThis, "fetch");
    process.env.GITHUB_CLIENT_ID = "client-id";
    process.env.GITHUB_CLIENT_SECRET = "client-secret"; // pragma: allowlist secret
    process.env.WEB_APP_URL = "https://mark.staging.skills.network";
    prisma.userCredential.findUnique.mockResolvedValue(null);
    stateService = new GithubOauthStateService();
  });

  afterEach(() => jest.restoreAllMocks());

  describe("getOAuthUrl", () => {
    it("encodes the redirect target and binds the handoff with a state parameter", async () => {
      const url = new URL(
        await make().getOAuthUrl(ASSIGNMENT, REDIRECT, LEARNER),
      );

      expect(url.origin + url.pathname).toBe(
        "https://github.com/login/oauth/authorize",
      );
      expect(url.searchParams.get("redirect_uri")).toBe(CALLBACK);
      // Encoded, not raw: the raw form lets a redirect's own query string
      // swallow the parameters that follow it.
      expect(url.search).toContain(encodeURIComponent(CALLBACK));
      const state = url.searchParams.get("state");
      expect(state).toBeTruthy();
      expect(stateService.verify(state ?? undefined, LEARNER)).toBe(true);
    });

    it("refuses a redirect target that is not a Mark page", async () => {
      expect.assertions(3);
      try {
        await make().getOAuthUrl(
          ASSIGNMENT,
          "https://attacker.example.com/steal?x=1&y=2",
          LEARNER,
        );
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(
          HttpStatus.BAD_REQUEST,
        );
        // The rejection must not echo the attacker-controlled value back.
        expect(JSON.stringify(bodyOf(error))).not.toContain("attacker");
      }
    });

    it("refuses a redirect target that is not a parseable absolute URL", async () => {
      await expect(
        make().getOAuthUrl(ASSIGNMENT, "/learner/3601/questions", LEARNER),
      ).rejects.toBeInstanceOf(HttpException);
    });

    it("refuses an unencrypted redirect target on the allowed host", async () => {
      await expect(
        make().getOAuthUrl(
          ASSIGNMENT,
          "http://mark.staging.skills.network/learner/3601/questions",
          LEARNER,
        ),
      ).rejects.toBeInstanceOf(HttpException);
    });

    // A state parameter signed with a key derived from nothing binds nothing.
    // Refuse to start the handoff rather than hand out a forgeable one.
    it("refuses to start a handoff it cannot bind to the session", async () => {
      delete process.env.GITHUB_CLIENT_SECRET;
      delete process.env.GITHUB_OAUTH_STATE_SECRET;

      expect.assertions(3);
      try {
        await make().getOAuthUrl(ASSIGNMENT, REDIRECT, LEARNER);
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect(bodyOf(error).code).toBe(GITHUB_OAUTH_ERROR_CODES.CONFIGURATION);
        expect(logged.error).toHaveBeenCalled();
      }
    });
  });

  describe("fixed callback", () => {
    it.each([
      "https://mark.skills.network",
      "https://mark.staging.skills.network",
    ])(
      "uses one callback for every assignment at %s and restores the signed destination",
      async (origin) => {
        process.env.WEB_APP_URL = origin;
        mockedFetch.mockResolvedValue(
          jsonResponse(200, { access_token: "ghu_test" }),
        );
        for (const id of [42, 3601]) {
          const destination = `${origin}/learner/${id}/questions?lang=zh-TW&authorMode=true#question-2`;
          const authorize = new URL(
            await make().getOAuthUrl(id, destination, LEARNER),
          );
          expect(authorize.searchParams.get("redirect_uri")).toBe(
            `${origin}/api/github/callback`,
          );
          expect(authorize.searchParams.has("scope")).toBe(false);
          const state = authorize.searchParams.get("state")!;
          const result = await make().completeOAuth(LEARNER, state, "the-code");
          expect(result.returnPath).toBe(
            `/learner/${id}/questions?lang=zh-TW&authorMode=true&github_auth=success#question-2`,
          );
          const body = new URLSearchParams(
            mockedFetch.mock.calls.at(-1)![1].body,
          );
          expect(body.get("redirect_uri")).toBe(
            `${origin}/api/github/callback`,
          );
          expect(JSON.stringify(result)).not.toContain("ghu_test");
          expect(JSON.stringify(result)).not.toContain("the-code");
        }
      },
    );

    it("returns to results after cancellation without exchanging a code", async () => {
      const destination =
        "https://mark.staging.skills.network/learner/3601/successPage/99?lang=fr";
      const authorize = new URL(
        await make().getOAuthUrl(ASSIGNMENT, destination, LEARNER),
      );
      expect(
        await make().completeOAuth(
          LEARNER,
          authorize.searchParams.get("state")!,
          undefined,
          "access_denied",
        ),
      ).toEqual({
        returnPath:
          "/learner/3601/successPage/99?lang=fr&github_auth=access_denied",
      });
      expect(mockedFetch).not.toHaveBeenCalled();
    });

    it.each([
      "https://evil.example/learner/3601/questions",
      "https://mark.staging.skills.network/api/github/callback",
      "https://user:pass@mark.staging.skills.network/learner/3601/questions",
    ])("refuses unsafe return destination %s", async (destination) => {
      await expect(
        make().getOAuthUrl(ASSIGNMENT, destination, LEARNER),
      ).rejects.toBeInstanceOf(HttpException);
    });

    it("cleans prior OAuth parameters before signing the destination", async () => {
      const authorize = new URL(
        await make().getOAuthUrl(
          ASSIGNMENT,
          `${REDIRECT}?lang=fr&code=old&state=old&error=old&github_auth=old`,
          LEARNER,
        ),
      );
      expect(
        stateService.returnUrl(authorize.searchParams.get("state")!, LEARNER),
      ).toBe(`${REDIRECT}?lang=fr`);
    });

    it("rejects another user's state before exchanging or redirecting", async () => {
      const state = stateService.issue(
        "other@example.com",
        ASSIGNMENT,
        REDIRECT,
      );
      await expect(
        make().completeOAuth(LEARNER, state, "the-code"),
      ).rejects.toBeInstanceOf(HttpException);
      expect(mockedFetch).not.toHaveBeenCalled();
    });

    it("rejects a changed return destination before exchanging", async () => {
      const state = stateService.issue(LEARNER, ASSIGNMENT, REDIRECT);
      const [encoded, signature] = state.split(".");
      const parts = Buffer.from(encoded, "base64url").toString().split("~");
      parts[3] = Buffer.from("https://evil.example/steal").toString(
        "base64url",
      );
      const tampered = `${Buffer.from(parts.join("~")).toString("base64url")}.${signature}`;
      await expect(
        make().completeOAuth(LEARNER, tampered, "the-code"),
      ).rejects.toBeInstanceOf(HttpException);
      expect(mockedFetch).not.toHaveBeenCalled();
    });

    it("rejects expired state and legacy state with no return destination", async () => {
      const now = Date.now();
      const expired = stateService.issue(LEARNER, ASSIGNMENT, REDIRECT);
      jest.spyOn(Date, "now").mockReturnValue(now + 16 * 60 * 1000);
      await expect(
        make().completeOAuth(LEARNER, expired, "the-code"),
      ).rejects.toBeInstanceOf(HttpException);
      await expect(
        make().completeOAuth(
          LEARNER,
          stateService.issue(LEARNER, ASSIGNMENT),
          "the-code",
        ),
      ).rejects.toBeInstanceOf(HttpException);
      expect(mockedFetch).not.toHaveBeenCalled();
    });

    it.each([
      ["bad_verification_code", "authorization_expired"],
      ["incorrect_client_credentials", "configuration"],
      ["access_denied", "access_denied"],
    ])("returns a safe outcome for %s", async (error, outcome) => {
      mockedFetch.mockResolvedValue(jsonResponse(200, { error }));
      expect(
        await make().completeOAuth(
          LEARNER,
          stateService.issue(LEARNER, ASSIGNMENT, REDIRECT),
          "the-code",
        ),
      ).toEqual({
        returnPath: `/learner/3601/questions?github_auth=${outcome}`,
      });
      expect(mockedFetch).toHaveBeenCalledTimes(1);
      expect(prisma.userCredential.create).not.toHaveBeenCalled();
    });
  });

  describe("exchangeCodeForToken", () => {
    const validState = () => stateService.issue(LEARNER, ASSIGNMENT);

    it("refuses a callback with no state at all", async () => {
      expect.assertions(3);
      try {
        await make().exchangeCodeForToken("the-code", LEARNER, undefined);
      } catch (error) {
        expect((error as HttpException).getStatus()).toBe(
          HttpStatus.BAD_REQUEST,
        );
        expect(bodyOf(error).code).toBe(
          GITHUB_OAUTH_ERROR_CODES.AUTHORIZATION_INVALID,
        );
        // No state, no outbound call.
        expect(mockedFetch).not.toHaveBeenCalled();
      }
    });

    it("reports an unsignable callback as a configuration fault, not as a bad authorization", async () => {
      const state = validState();
      delete process.env.GITHUB_CLIENT_SECRET;
      delete process.env.GITHUB_OAUTH_STATE_SECRET;

      expect.assertions(3);
      try {
        await make().exchangeCodeForToken("the-code", LEARNER, state);
      } catch (error) {
        expect(bodyOf(error).code).toBe(GITHUB_OAUTH_ERROR_CODES.CONFIGURATION);
        expect(logged.error).toHaveBeenCalled();
        expect(mockedFetch).not.toHaveBeenCalled();
      }
    });

    it("refuses a state minted for a different session", async () => {
      const foreignState = stateService.issue(
        "someone-else@example.com",
        ASSIGNMENT,
      );

      await expect(
        make().exchangeCodeForToken("the-code", LEARNER, foreignState),
      ).rejects.toBeInstanceOf(HttpException);
      expect(mockedFetch).not.toHaveBeenCalled();
    });

    it("surfaces a generic 502 (no internal URL leak) when GitHub closes the connection", async () => {
      mockedFetch.mockResolvedValue(prematureCloseResponse());

      expect.assertions(4);
      try {
        await make().exchangeCodeForToken("the-code", LEARNER, validState());
      } catch (error) {
        const err = error as HttpException;
        expect(err).toBeInstanceOf(HttpException);
        expect(err.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
        // The internal endpoint must never reach the client.
        expect(JSON.stringify(err.getResponse())).not.toContain("github.com");
        // The failure must be observable server-side.
        expect(logged.error).toHaveBeenCalled();
      }
    });

    it("retries a transient transport failure and then succeeds", async () => {
      mockedFetch
        .mockResolvedValueOnce(prematureCloseResponse())
        .mockResolvedValueOnce(jsonResponse(200, { access_token: "gho_abc" }));

      const token = await make().exchangeCodeForToken(
        "the-code",
        LEARNER,
        validState(),
      );

      expect(token).toBe("gho_abc");
      expect(mockedFetch).toHaveBeenCalledTimes(2);
      expect(prisma.userCredential.create).toHaveBeenCalledWith({
        data: { userId: LEARNER, githubToken: "gho_abc" },
      });
    });

    it("does not retry a definitive GitHub error response (single-use code is preserved)", async () => {
      mockedFetch.mockResolvedValue(
        jsonResponse(200, { error: "bad_verification_code" }),
      );

      await expect(
        make().exchangeCodeForToken("used-code", LEARNER, validState()),
      ).rejects.toBeInstanceOf(HttpException);
      expect(mockedFetch).toHaveBeenCalledTimes(1);
    });

    it("reports a mis-paired client id/secret as an unavailable integration, not as the learner's problem", async () => {
      mockedFetch.mockResolvedValue(
        jsonResponse(200, {
          error: "incorrect_client_credentials",
          error_description: "The client_id and/or client_secret are incorrect",
        }),
      );

      expect.assertions(4);
      try {
        await make().exchangeCodeForToken("the-code", LEARNER, validState());
      } catch (error) {
        const body = JSON.stringify(bodyOf(error));
        expect((error as HttpException).getStatus()).toBe(
          HttpStatus.SERVICE_UNAVAILABLE,
        );
        expect(bodyOf(error).code).toBe(GITHUB_OAUTH_ERROR_CODES.CONFIGURATION);
        // GitHub's own wording stays server-side.
        expect(body).not.toContain("incorrect_client_credentials");
        expect(body).not.toContain("client_secret");
      }
    });

    it("reports a consumed or stale code as a re-authorization prompt", async () => {
      mockedFetch.mockResolvedValue(
        jsonResponse(200, { error: "bad_verification_code" }),
      );

      expect.assertions(3);
      try {
        await make().exchangeCodeForToken("used-code", LEARNER, validState());
      } catch (error) {
        expect((error as HttpException).getStatus()).toBe(
          HttpStatus.BAD_REQUEST,
        );
        expect(bodyOf(error).code).toBe(
          GITHUB_OAUTH_ERROR_CODES.AUTHORIZATION_EXPIRED,
        );
        expect(JSON.stringify(bodyOf(error))).not.toContain(
          "bad_verification_code",
        );
      }
    });

    it("reports a declined authorization distinctly", async () => {
      mockedFetch.mockResolvedValue(
        jsonResponse(200, { error: "access_denied" }),
      );

      expect.assertions(1);
      try {
        await make().exchangeCodeForToken("the-code", LEARNER, validState());
      } catch (error) {
        expect(bodyOf(error).code).toBe(GITHUB_OAUTH_ERROR_CODES.ACCESS_DENIED);
      }
    });

    it("logs the rejection with structured context and without credentials", async () => {
      mockedFetch.mockResolvedValue(
        jsonResponse(200, { error: "incorrect_client_credentials" }),
      );

      await expect(
        make().exchangeCodeForToken("the-code", LEARNER, validState()),
      ).rejects.toBeInstanceOf(HttpException);

      expect(logged.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          user_id: LEARNER,
          stage: "token_exchange",
          github_error: "incorrect_client_credentials",
        }),
      );
      const everythingLogged = JSON.stringify([
        logged.error.mock.calls,
        logged.warn.mock.calls,
        logged.info.mock.calls,
      ]);
      expect(everythingLogged).not.toContain("client-secret");
      expect(everythingLogged).not.toContain("the-code");
    });

    it("never logs the issued access token", async () => {
      mockedFetch.mockResolvedValue(
        jsonResponse(200, { access_token: "gho_supersecret" }),
      );

      await make().exchangeCodeForToken("the-code", LEARNER, validState());

      expect(
        JSON.stringify([logged.info.mock.calls, logged.warn.mock.calls]),
      ).not.toContain("gho_supersecret");
    });
  });
});
