jest.mock("../api-client", () => ({
  apiClient: { patch: jest.fn() },
}));

jest.mock("sonner", () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

import { toast } from "sonner";
import { apiClient } from "../api-client";
import { parseSubmitResult, submitAssignment } from "../learner";

const gradedInline = {
  id: 42,
  submitted: true,
  grade: 0.8,
  totalPointsEarned: 8,
  totalPossiblePoints: 10,
  passed: true,
  showAssignmentScore: true,
  showSubmissionFeedback: true,
  showQuestions: true,
  showQuestionScore: true,
  showPassFailIndicator: true,
  correctAnswerVisibility: "ON_PASS",
  feedbacksForQuestions: [
    {
      id: 5,
      questionId: 50,
      totalPoints: 8,
      feedback: [{ feedback: "Good" }],
    },
  ],
};

describe("submitAssignment synchronous grading response", () => {
  beforeEach(() => {
    (apiClient.patch as jest.Mock).mockReset();
  });

  it("resolves immediately with the graded attempt when no gradingJobId is returned", async () => {
    (apiClient.patch as jest.Mock).mockResolvedValue(gradedInline);

    const result = await submitAssignment(1, 42, []);

    expect(result).toEqual(gradedInline);
  });

  it("reads the response as plain JSON but still encodes the request", async () => {
    (apiClient.patch as jest.Mock).mockResolvedValue(gradedInline);

    await submitAssignment(1, 42, [{ id: 50, learnerTextResponse: "hi" }]);

    const options = (apiClient.patch as jest.Mock).mock.calls[0][2];
    expect(options.transformResponse).toBe(false);
    expect(options.transformRequest).toBeUndefined();
  });

  it("still rejects when the response has neither a job id nor a graded attempt", async () => {
    (apiClient.patch as jest.Mock).mockResolvedValue({ message: "weird" });

    await expect(submitAssignment(1, 42, [])).rejects.toThrow(
      "No grading job ID returned",
    );
  });

  it("shows the server's message for an unsupported question type", async () => {
    (apiClient.patch as jest.Mock).mockRejectedValue(
      Object.assign(new Error("Bad Request"), {
        status: 400,
        body: {
          statusCode: 400,
          code: "UNSUPPORTED_RESPONSE_TYPE",
          message: "Question 3 can no longer be answered.",
        },
      }),
    );

    await expect(submitAssignment(1, 42, [])).rejects.toThrow(
      "Question 3 can no longer be answered.",
    );
    expect(toast.error).toHaveBeenCalledWith(
      "Question 3 can no longer be answered.",
    );
  });
});

describe("parseSubmitResult", () => {
  it("keeps hidden values null instead of inventing numbers", () => {
    expect(
      parseSubmitResult({
        id: 3,
        grade: null,
        totalPointsEarned: null,
        totalPossiblePoints: null,
        passed: null,
        feedbacksForQuestions: [
          { id: 1, questionId: 9, totalPoints: null, feedback: null },
        ],
      }),
    ).toMatchObject({
      id: 3,
      grade: null,
      totalPointsEarned: null,
      totalPossiblePoints: null,
      passed: null,
      correctAnswerVisibility: "NEVER",
      feedbacksForQuestions: [
        { id: 1, questionId: 9, totalPoints: null, feedback: null },
      ],
    });
  });

  it("drops fields the result no longer carries", () => {
    const parsed = parseSubmitResult({
      ...gradedInline,
      success: true,
      message: "done",
      feedbacksForQuestions: [
        {
          id: 5,
          questionId: 50,
          totalPoints: 8,
          feedback: [],
          question: "the learner's answer",
          metadata: { model: "x" },
          points: 8,
        },
      ],
    });

    expect(parsed).not.toHaveProperty("success");
    expect(parsed).not.toHaveProperty("message");
    expect(parsed?.feedbacksForQuestions[0]).toEqual({
      id: 5,
      questionId: 50,
      totalPoints: 8,
      feedback: [],
    });
  });

  it("parses the JSON string a finalize frame carries", () => {
    expect(parseSubmitResult(JSON.stringify(gradedInline))).toEqual(
      gradedInline,
    );
  });

  it("returns undefined for anything that is not a graded attempt", () => {
    expect(parseSubmitResult("{not json")).toBeUndefined();
    expect(parseSubmitResult({ gradingJobId: "j" })).toBeUndefined();
    expect(parseSubmitResult(null)).toBeUndefined();
  });
});
