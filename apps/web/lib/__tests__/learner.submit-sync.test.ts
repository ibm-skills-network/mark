jest.mock("../api-client", () => ({
  apiClient: { patch: jest.fn() },
}));

import { apiClient } from "../api-client";
import { submitAssignment } from "../learner";

describe("submitAssignment synchronous grading response", () => {
  it("resolves immediately with the graded attempt when no gradingJobId is returned", async () => {
    (apiClient.patch as jest.Mock).mockResolvedValue({
      id: 42,
      success: true,
      grade: 0.8,
      showSubmissionFeedback: true,
      feedbacksForQuestions: [],
      totalPointsEarned: 8,
      totalPossiblePoints: 10,
    });

    const result = await submitAssignment(1, 42, []);

    expect(result?.id).toBe(42);
    expect(result?.totalPointsEarned).toBe(8);
  });

  it("still rejects when the response has neither a job id nor a graded attempt", async () => {
    (apiClient.patch as jest.Mock).mockResolvedValue({ message: "weird" });

    await expect(submitAssignment(1, 42, [])).rejects.toThrow(
      "No grading job ID returned",
    );
  });
});
