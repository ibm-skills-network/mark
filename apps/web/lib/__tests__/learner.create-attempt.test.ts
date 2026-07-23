jest.mock("../api-client", () => {
  class MockAPIError extends Error {
    constructor(
      message: string,
      public status: number,
      public statusText: string,
      public body?: unknown,
    ) {
      super(message);
      this.name = "APIError";
    }
  }
  return {
    apiClient: { post: jest.fn() },
    APIError: MockAPIError,
  };
});

import { apiClient, APIError } from "../api-client";
import { createAttempt } from "../learner";

const unprocessable = (body: unknown) =>
  new APIError("Unprocessable Entity", 422, "Unprocessable Entity", body);

describe("createAttempt 422 handling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does NOT report 'no more attempts' when the API says an attempt is already in progress", async () => {
    (apiClient.post as jest.Mock).mockRejectedValue(
      unprocessable({
        statusCode: 422,
        code: "ATTEMPT_IN_PROGRESS",
        message: "A attempt is already in progress and has not expired.",
      }),
    );

    const result = await createAttempt(123);

    expect(result).not.toBe("no more attempts");
    expect(result).toBe("attempt in progress");
  });

  it("maps ATTEMPT_TIME_RANGE_EXCEEDED to a distinct result", async () => {
    (apiClient.post as jest.Mock).mockRejectedValue(
      unprocessable({
        statusCode: 422,
        code: "ATTEMPT_TIME_RANGE_EXCEEDED",
        message:
          "You have exceeded the allowed number of attempts within the specified time range.",
      }),
    );

    const result = await createAttempt(123);

    expect(result).toBe("time range exceeded");
  });

  it("maps ATTEMPT_MAX_REACHED to 'no more attempts'", async () => {
    (apiClient.post as jest.Mock).mockRejectedValue(
      unprocessable({
        statusCode: 422,
        code: "ATTEMPT_MAX_REACHED",
        message: "Maximum number of attempts reached for this assignment.",
      }),
    );

    await expect(createAttempt(123)).resolves.toBe("no more attempts");
  });

  it("keeps the legacy fallback: a 422 without a code still maps to 'no more attempts'", async () => {
    (apiClient.post as jest.Mock).mockRejectedValue(
      unprocessable({
        statusCode: 422,
        message: "Maximum number of attempts reached for this assignment.",
      }),
    );

    await expect(createAttempt(123)).resolves.toBe("no more attempts");
  });

  it("still maps 429 to 'in cooldown period'", async () => {
    (apiClient.post as jest.Mock).mockRejectedValue(
      new APIError("Too Many Requests", 429, "Too Many Requests", {
        statusCode: 429,
        message: "cooldown",
      }),
    );

    await expect(createAttempt(123)).resolves.toBe("in cooldown period");
  });
});
