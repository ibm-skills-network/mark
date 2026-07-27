/**
 * @jest-environment node
 */

import { APIError } from "../api-client";
import { getAttempts } from "../author";
import { getAttempt } from "../learner";

jest.mock("../api-client", () => {
  const actual = jest.requireActual("../api-client");
  return {
    ...actual,
    apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
  };
});

// Retry pauses briefly between attempts; keep tests instant.
jest.mock("../api-retry", () => {
  const actual = jest.requireActual("../api-retry");
  return {
    ...actual,
    withTransientRetry: async <T,>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (error) {
        if (!actual.isTransientApiError(error)) throw error;
        return fn();
      }
    },
  };
});

const { apiClient }: { apiClient: { get: jest.Mock } } =
  jest.requireMock("../api-client");

const attemptRow = {
  id: 7,
  submitted: false,
  expiresAt: null,
  createdAt: "2026-07-01T00:00:00.000Z",
};

beforeEach(() => {
  apiClient.get.mockReset();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getAttempts", () => {
  it("recovers when the first request fails transiently", async () => {
    apiClient.get
      .mockRejectedValueOnce(new APIError("x", 503, "Service Unavailable"))
      .mockResolvedValueOnce([attemptRow]);

    const attempts = await getAttempts(1);

    expect(attempts).toHaveLength(1);
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });

  it("logs and returns undefined on persistent failure", async () => {
    apiClient.get.mockRejectedValue(new APIError("x", 503, "x"));

    await expect(getAttempts(1)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it("suppresses the api-client toast via quiet mode", async () => {
    apiClient.get.mockResolvedValue([attemptRow]);

    await getAttempts(1);

    expect(apiClient.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ quiet: true }),
    );
  });

  it("rethrows auth failures when the caller opts in", async () => {
    apiClient.get.mockRejectedValue(new APIError("x", 401, "Unauthorized"));

    await expect(
      getAttempts(1, undefined, { throwOnAuthError: true }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("swallows auth failures by default (legacy callers)", async () => {
    apiClient.get.mockRejectedValue(new APIError("x", 401, "Unauthorized"));

    await expect(getAttempts(1)).resolves.toBeUndefined();
  });
});

describe("getAttempt", () => {
  it("recovers when the first request fails transiently", async () => {
    apiClient.get
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce({ id: 7, questions: [] });

    const attempt = await getAttempt(1, 7);

    expect(attempt).toMatchObject({ id: 7 });
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });

  it("does not retry definitive failures", async () => {
    apiClient.get.mockRejectedValue(new APIError("x", 404, "Not Found"));

    await expect(getAttempt(1, 7)).resolves.toBeUndefined();
    expect(apiClient.get).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalled();
  });

  it("rethrows auth failures when the caller opts in", async () => {
    apiClient.get.mockRejectedValue(new APIError("x", 403, "Forbidden"));

    await expect(
      getAttempt(1, 7, undefined, "en", { throwOnAuthError: true }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
