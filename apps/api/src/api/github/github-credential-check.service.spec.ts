import "reflect-metadata";
import type { Logger as WinstonLogger } from "winston";

import { GithubCredentialCheckService } from "./github-credential-check.service";

let mockedFetch: jest.SpyInstance;

const logged = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
const winston = { child: jest.fn(() => logged) } as unknown as WinstonLogger;

const jsonResponse = (body: unknown) =>
  ({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue(body),
  }) as unknown as Response;

const make = () => new GithubCredentialCheckService(winston);

describe("GithubCredentialCheckService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFetch = jest.spyOn(globalThis, "fetch");
    process.env.GITHUB_CLIENT_ID = "client-id";
    process.env.GITHUB_CLIENT_SECRET = "client-secret"; // pragma: allowlist secret
  });

  afterEach(() => jest.restoreAllMocks());

  it("reports a mis-paired client id/secret and logs it at error level", async () => {
    mockedFetch.mockResolvedValue(
      jsonResponse({ error: "incorrect_client_credentials" }),
    );

    const service = make();
    const status = await service.run();

    expect(status.state).toBe("misconfigured");
    expect(service.getStatus().state).toBe("misconfigured");
    expect(logged.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        stage: "credential_self_check",
        github_error: "incorrect_client_credentials",
      }),
    );
  });

  it("treats a rejected junk code as a healthy credential pair", async () => {
    mockedFetch.mockResolvedValue(
      jsonResponse({ error: "bad_verification_code" }),
    );

    const status = await make().run();

    expect(status.state).toBe("ok");
    expect(logged.error).not.toHaveBeenCalled();
  });

  it("reports missing credentials without calling GitHub", async () => {
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;

    const status = await make().run();

    expect(status.state).toBe("not_configured");
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("reports a transport failure as unreachable rather than misconfigured", async () => {
    mockedFetch.mockRejectedValue(new Error("Premature close"));

    const status = await make().run();

    expect(status.state).toBe("unreachable");
    expect(logged.warn).toHaveBeenCalled();
  });

  it("never logs the credentials it probes with", async () => {
    mockedFetch.mockResolvedValue(
      jsonResponse({ error: "incorrect_client_credentials" }),
    );

    await make().run();

    const everythingLogged = JSON.stringify([
      logged.error.mock.calls,
      logged.warn.mock.calls,
      logged.info.mock.calls,
    ]);
    expect(everythingLogged).not.toContain("client-secret");
    expect(everythingLogged).not.toContain("client-id");
  });

  it("starts out unknown until the probe has run", () => {
    expect(make().getStatus().state).toBe("unknown");
  });
});

describe("credential probe unexpected responses", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFetch = jest.spyOn(globalThis, "fetch");
    process.env.GITHUB_CLIENT_ID = "client-id";
    process.env.GITHUB_CLIENT_SECRET = "client-secret"; // pragma: allowlist secret
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    [503, { message: "unavailable" }],
    [429, { error: "rate_limited" }],
    [200, {}],
    [200, { error: "unexpected_error" }],
    [503, { error: "bad_verification_code" }],
  ])("does not report healthy for HTTP %s with %j", async (status, body) => {
    mockedFetch.mockResolvedValue({ ...jsonResponse(body), status });
    expect((await make().run()).state).toBe("unreachable");
    expect(logged.info).not.toHaveBeenCalled();
  });
});
