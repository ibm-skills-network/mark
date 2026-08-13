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
import { submitQuestion } from "../learner";
import type { QuestionAttemptRequest } from "@config/types";

const samplePayload: QuestionAttemptRequest = {
  learnerTextResponse: "answer",
};

describe("submitQuestion", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns ok:true with the response data on success", async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({
      id: 1,
      questionId: 2,
      question: "",
    });

    const result = await submitQuestion(10, 20, 2, samplePayload);

    expect(result).toEqual({
      ok: true,
      data: { id: 1, questionId: 2, question: "" },
    });
  });

  it("passes quiet:true so apiClient's generic status-code toast never fires for this call", async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({
      id: 1,
      questionId: 2,
      question: "",
    });

    await submitQuestion(10, 20, 2, samplePayload);

    expect((apiClient.post as jest.Mock).mock.calls[0]).toEqual([
      expect.any(String),
      expect.anything(),
      expect.objectContaining({ quiet: true }),
    ]);
  });

  it("surfaces the server's learner-safe message for a 4xx failure", async () => {
    (apiClient.post as jest.Mock).mockRejectedValue(
      new APIError("Bad Request", 400, "Bad Request", {
        statusCode: 400,
        message:
          "Your submission is too large for automatic grading. Try reducing its length (fewer pages, rows, or sheets) and submit it again.",
        error: "Bad Request",
      }),
    );

    const result = await submitQuestion(10, 20, 2, samplePayload);

    expect(result).toEqual({
      ok: false,
      status: 400,
      message:
        "Your submission is too large for automatic grading. Try reducing its length (fewer pages, rows, or sheets) and submit it again.",
    });
  });

  it("never leaks a 5xx response body as a learner-facing message", async () => {
    (apiClient.post as jest.Mock).mockRejectedValue(
      new APIError("Internal Server Error", 500, "Internal Server Error", {
        statusCode: 500,
        message: "Internal server error",
      }),
    );

    const result = await submitQuestion(10, 20, 2, samplePayload);

    expect(result).toEqual({ ok: false, status: 500, message: undefined });
  });

  it("returns ok:false with no status for a non-HTTP failure (e.g. a network error)", async () => {
    (apiClient.post as jest.Mock).mockRejectedValue(
      new TypeError("Failed to fetch"),
    );

    const result = await submitQuestion(10, 20, 2, samplePayload);

    expect(result).toEqual({ ok: false, status: undefined, message: undefined });
  });

  it("never throws, even when apiClient.post rejects with a bare Error", async () => {
    (apiClient.post as jest.Mock).mockRejectedValue(new Error("boom"));

    await expect(submitQuestion(10, 20, 2, samplePayload)).resolves.toEqual({
      ok: false,
      status: undefined,
      message: undefined,
    });
  });

  it("logs the failure with structured context, not the raw answer payload", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation();
    (apiClient.post as jest.Mock).mockRejectedValue(
      new APIError("Bad Request", 400, "Bad Request", {
        statusCode: 400,
        message: "Too large",
      }),
    );

    await submitQuestion(10, 20, 2, samplePayload);

    expect(consoleError).toHaveBeenCalledWith(
      "submitQuestion failed",
      expect.objectContaining({
        assignmentId: 10,
        attemptId: 20,
        questionId: 2,
        status: 400,
      }),
    );
    // The learner's actual answer text must never end up in the log call.
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ requestBody: expect.anything() }),
    );

    consoleError.mockRestore();
  });
});
