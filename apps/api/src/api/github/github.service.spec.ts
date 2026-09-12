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
      expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
      // Encoded, not raw: the raw form lets a redirect's own query string
      // swallow the parameters that follow it.
      expect(url.search).toContain(encodeURIComponent(REDIRECT));
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
