import "reflect-metadata";
import { HttpException, HttpStatus, Logger } from "@nestjs/common";

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

const make = () => new GithubService(prisma as never);

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
    json: jest.fn().mockRejectedValue(
      Object.assign(
        new Error(
          "Invalid response body while trying to fetch " +
            "https://github.com/login/oauth/access_token: Premature close",
        ),
        { name: "FetchError", type: "system" },
      ),
    ),
  }) as unknown as Response;

describe("GithubService.exchangeCodeForToken", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Fresh spy on the global fetch each test; restoreAllMocks (afterEach) puts
    // the real one back so nothing leaks between tests.
    mockedFetch = jest.spyOn(globalThis, "fetch");
    process.env.GITHUB_CLIENT_ID = "client-id";
    process.env.GITHUB_CLIENT_SECRET = "client-secret"; // pragma: allowlist secret
    prisma.userCredential.findUnique.mockResolvedValue(null);
    // Expected, asserted-on log noise — keep test output pristine.
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it("surfaces a generic 502 (no internal URL leak) when GitHub closes the connection", async () => {
    mockedFetch.mockResolvedValue(prematureCloseResponse());
    const errorSpy = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);

    expect.assertions(4);
    try {
      await make().exchangeCodeForToken("the-code", "user@example.com");
    } catch (error) {
      const err = error as HttpException;
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
      // The internal endpoint must never reach the client.
      expect(JSON.stringify(err.getResponse())).not.toContain("github.com");
      // The failure must be observable server-side.
      expect(errorSpy).toHaveBeenCalled();
    }
  });

  it("retries a transient transport failure and then succeeds", async () => {
    mockedFetch
      .mockResolvedValueOnce(prematureCloseResponse())
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "gho_abc" }));

    const token = await make().exchangeCodeForToken(
      "the-code",
      "user@example.com",
    );

    expect(token).toBe("gho_abc");
    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(prisma.userCredential.create).toHaveBeenCalledWith({
      data: { userId: "user@example.com", githubToken: "gho_abc" },
    });
  });

  it("does not retry a definitive GitHub error response (single-use code is preserved)", async () => {
    mockedFetch.mockResolvedValue(
      jsonResponse(200, { error: "bad_verification_code" }),
    );

    await expect(
      make().exchangeCodeForToken("used-code", "user@example.com"),
    ).rejects.toBeInstanceOf(HttpException);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });
});
