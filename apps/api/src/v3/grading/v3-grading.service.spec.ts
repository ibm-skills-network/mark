import type { Logger } from "winston";
import type { GradingQuestion } from "./contracts";
import type { GradingModelClient, GradingModelRequest } from "./model-client";
import { V3GradingService } from "./v3-grading.service";

describe("V3GradingService", () => {
  it("grades learners without debug: no reasoning summary, no debug block", async () => {
    const requests: GradingModelRequest[] = [];
    const client: GradingModelClient = {
      complete(request) {
        requests.push(request);
        return Promise.resolve({
          outputText: JSON.stringify({
            verdicts: [
              {
                criterionId: "c1",
                points: 1,
                reason: "r",
                quotes: [{ part: "answer", text: "42" }],
                feedback: "f",
                needsVerification: false,
                verificationReason: null,
              },
            ],
            overallFeedback: "ok",
            solidAttempt: true,
            solidAttemptReason: "r",
          }),
          usage: {
            inputTokens: 1,
            cachedInputTokens: 0,
            outputTokens: 1,
            reasoningTokens: 0,
          },
          model: "fake",
          reasoningSummary: ["should not be asked for"],
        });
      },
    };
    const quiet = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const logger = { child: () => quiet } as unknown as Logger;
    const service = new V3GradingService(logger, client);
    const question: GradingQuestion = {
      questionId: 1,
      questionType: "TEXT",
      questionText: "q",
      rubric: { criteria: [{ id: "c1", description: "d", maxPoints: 1 }] },
      totalPoints: 1,
      effort: "low",
    };
    const outcome = await service.grade(question, { text: "It is 42" }, {});
    expect(requests[0].reasoningSummary).toBeFalsy();
    expect(outcome.status).toBe("graded");
    if (outcome.status === "graded") {
      expect(outcome.result.debug).toBeUndefined();
    }
  });
});
