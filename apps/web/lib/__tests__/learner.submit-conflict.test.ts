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
    apiClient: { patch: jest.fn(), post: jest.fn(), get: jest.fn() },
    APIError: MockAPIError,
  };
});

import { apiClient, APIError } from "../api-client";
import {
  isAiTemporarilyDisabled,
  isAttemptAlreadySubmittedError,
  submitAssignment,
} from "../learner";

const conflict = (body: unknown) =>
  new APIError("Conflict", 409, "Conflict", body);

const alreadySubmittedBody = {
  statusCode: 409,
  message: "Attempt 999 has already been submitted.",
  error: "Conflict",
};

describe("submit 409 handling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does not treat a plain 409 (duplicate submit) as the AI kill-switch", () => {
    // Prod, Aug–Sep 2026: every "grading temporarily out of service" report
    // was a duplicate PATCH on an attempt that was already graded.
    expect(isAiTemporarilyDisabled(conflict(alreadySubmittedBody))).toBe(false);
  });

  it("still recognises the kill-switch by its body code", () => {
    expect(
      isAiTemporarilyDisabled(
        conflict({
          statusCode: 409,
          code: "AI_TEMPORARILY_DISABLED",
          message: "AI grading is temporarily unavailable.",
        }),
      ),
    ).toBe(true);
  });

  it("rejects with an already-submitted error carrying the attempt id", async () => {
    (apiClient.patch as jest.Mock).mockRejectedValue(
      conflict(alreadySubmittedBody),
    );

    const err: unknown = await submitAssignment(3428, 999, []).catch(
      (error: unknown) => error,
    );

    expect(isAttemptAlreadySubmittedError(err)).toBe(true);
    expect((err as { attemptId?: number }).attemptId).toBe(999);
  });
});
