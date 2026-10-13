/**
 * @jest-environment jsdom
 */

import {
  APIClient,
  APIError,
  NetworkError,
  isNetworkError,
} from "../api-client";
import { clearRequestLog, recentClientErrors } from "../request-log";

jest.mock("../../app/Helpers/data-transformer", () => ({
  DataTransformer: {
    encodeForAPI: jest.fn((data: unknown) => ({ data })),
    decodeFromAPI: jest.fn((data: unknown) => data),
  },
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

const abortError = () =>
  new DOMException("The operation was aborted.", "AbortError");

describe("APIClient network failure classification", () => {
  let client: APIClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new APIClient({ baseURL: "http://localhost:3000", timeout: 20 });
  });

  // The client used to convert its own AbortController firing into
  // APIError(408). Nothing on the server ever sent a 408, so support triage
  // saw a fake server status for what is a stalled browser request — and
  // ErrorPage, having no 408 headline, captioned it "Something went wrong on
  // our side".
  it("reports its own timeout as a network failure, not an HTTP status", async () => {
    mockFetch.mockRejectedValue(abortError());

    const failure = await client.get("/thing").catch((error: unknown) => error);

    expect(isNetworkError(failure)).toBe(true);
    expect(failure).toBeInstanceOf(NetworkError);
    expect((failure as NetworkError).kind).toBe("timeout");
    expect(failure).not.toBeInstanceOf(APIError);
    expect(failure).not.toHaveProperty("status");
  });

  it("recognises an abort raised as a plain Error across a module realm", async () => {
    const aborted = new Error("The operation was aborted.");
    aborted.name = "AbortError";
    mockFetch.mockRejectedValue(aborted);

    const failure = await client.get("/thing").catch((error: unknown) => error);

    expect(isNetworkError(failure)).toBe(true);
    expect((failure as NetworkError).kind).toBe("timeout");
  });

  // fetch rejects with a bare TypeError when the connection drops, the proxy
  // kills the socket, or the device is offline. statusFromError floors
  // anything without a status to 500, so these were reported to learners as a
  // server fault too.
  it("reports a dropped connection as unreachable, not a server fault", async () => {
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));

    const failure = await client.get("/thing").catch((error: unknown) => error);

    expect(isNetworkError(failure)).toBe(true);
    expect((failure as NetworkError).kind).toBe("unreachable");
    expect(failure).not.toHaveProperty("status");
  });

  // A caller that cancels on purpose (component unmounted, newer request
  // superseded this one) has not hit a failure worth showing anyone.
  it("rethrows a caller-initiated abort unchanged", async () => {
    const controller = new AbortController();
    controller.abort();
    mockFetch.mockRejectedValue(abortError());

    const failure = await client
      .get("/thing", { signal: controller.signal })
      .catch((error: unknown) => error);

    expect(isNetworkError(failure)).toBe(false);
    expect((failure as Error).name).toBe("AbortError");
  });

  it("still surfaces real HTTP statuses as APIError", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      json: jest.fn().mockResolvedValue({ message: "down" }),
    });

    const failure = await client
      .get("/thing", { quiet: true })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(APIError);
    expect((failure as APIError).status).toBe(503);
    expect(isNetworkError(failure)).toBe(false);
  });

  // A 200 whose body never arrives intact is the connection's failure, not
  // ours: a link that drops mid-transfer, or a data-saving proxy that rewrites
  // or truncates the body. Reading it used to throw a bare SyntaxError or
  // TypeError with no status, which the error screen floored to "500 —
  // Something went wrong on our side" and auto-filed as a server fault.
  it.each([
    [
      "a body that is not the JSON the server sent",
      new SyntaxError(
        "Unexpected token '<', \"<html><bo\"... is not valid JSON",
      ),
    ],
    ["a body stream that was cut off", new TypeError("network error")],
  ])("reports %s after a 2xx as an interrupted response", async (_l, cause) => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-length": "74824" }),
      json: jest.fn().mockRejectedValue(cause),
    });

    const failure = await client.get("/thing").catch((error: unknown) => error);

    expect(isNetworkError(failure)).toBe(true);
    expect((failure as NetworkError).kind).toBe("interrupted");
    expect(failure).not.toHaveProperty("status");
    expect((failure as NetworkError).detail).toContain(cause.name);
  });

  // The parser's message quotes the start of the body; that is response
  // content and must not travel into a bug report.
  it("keeps the parser's error name but not the body excerpt it quotes", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      json: jest
        .fn()
        .mockRejectedValue(
          new SyntaxError(
            "Unexpected token 'a', \"alice@example.com\" is not valid JSON",
          ),
        ),
    });

    const failure = (await client
      .get("/thing")
      .catch((error: unknown) => error)) as NetworkError;

    expect(failure.detail).toMatch(/^SyntaxError: /);
    expect(failure.detail).not.toContain("alice");
  });

  // An empty 2xx is what the server deliberately sent (a handler with no
  // return value); a retry returns the same thing, so it stays what it was.
  it("does not treat a deliberately empty 2xx body as a dropped connection", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-length": "0" }),
      json: jest
        .fn()
        .mockRejectedValue(new SyntaxError("Unexpected end of JSON input")),
    });

    const failure = await client.get("/thing").catch((error: unknown) => error);

    expect(isNetworkError(failure)).toBe(false);
    expect(failure).toBeInstanceOf(SyntaxError);
  });

  it("leaves a trace of the interrupted response for a bug report", async () => {
    clearRequestLog();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      json: jest.fn().mockRejectedValue(new TypeError("network error")),
    });

    await client.get("/api/v2/assignments/3049?lang=en").catch(() => undefined);

    expect(recentClientErrors()).toEqual([
      expect.objectContaining({
        name: "NetworkError",
        kind: "interrupted",
        detail: "TypeError: network error",
        path: "/api/v2/assignments/3049",
      }),
    ]);
  });

  it("recognises an interrupted response by shape across a module realm", () => {
    expect(isNetworkError({ name: "NetworkError", kind: "interrupted" })).toBe(
      true,
    );
  });
});
