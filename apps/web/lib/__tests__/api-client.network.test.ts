/**
 * @jest-environment jsdom
 */

import {
  APIClient,
  APIError,
  NetworkError,
  isNetworkError,
} from "../api-client";

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

  // A body that arrives but cannot be decoded is our bug, not the network's.
  it("does not disguise a response-parsing failure as a network failure", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: jest.fn().mockRejectedValue(new TypeError("Unexpected token")),
    });

    const failure = await client.get("/thing").catch((error: unknown) => error);

    expect(isNetworkError(failure)).toBe(false);
    expect(failure).toBeInstanceOf(TypeError);
  });
});
