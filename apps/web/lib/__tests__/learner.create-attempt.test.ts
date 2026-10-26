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
import { abandonAttempt, createAttempt } from "../learner";

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

describe("createAttempt 403 handling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("maps 403 ASSIGNMENT_NOT_PUBLISHED to 'assignment not published'", async () => {
    (apiClient.post as jest.Mock).mockRejectedValue(
      new APIError("Forbidden", 403, "Forbidden", {
        statusCode: 403,
        code: "ASSIGNMENT_NOT_PUBLISHED",
        message: "Assignment is not published.",
      }),
    );

    await expect(createAttempt(123)).resolves.toBe("assignment not published");
  });

  it("leaves an uncoded 403 on the generic failure path", async () => {
    (apiClient.post as jest.Mock).mockRejectedValue(
      new APIError("Forbidden", 403, "Forbidden", {
        statusCode: 403,
        message: "Forbidden resource",
      }),
    );

    await expect(createAttempt(123)).resolves.toBeUndefined();
  });
});

const { apiClient: mockedClient }: { apiClient: { post: jest.Mock } } =
  jest.requireMock("../api-client");

describe("plain JSON responses", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("createAttempt asks the client not to transform the response", async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({
      id: 9,
      success: true,
      serverNow: "2026-10-23T00:00:00.000Z",
    });

    await expect(createAttempt(123)).resolves.toBe(9);
    expect(mockedClient.post).toHaveBeenCalledWith(
      expect.any(String),
      undefined,
      expect.objectContaining({ transformResponse: false }),
    );
  });

  it("abandonAttempt asks the client not to transform the response", async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({ id: 9, success: true });

    await expect(abandonAttempt(123, 9)).resolves.toBe(true);
    expect(mockedClient.post).toHaveBeenCalledWith(
      expect.stringContaining("/attempts/9/abandon"),
      {},
      expect.objectContaining({ transformResponse: false }),
    );
  });
});
