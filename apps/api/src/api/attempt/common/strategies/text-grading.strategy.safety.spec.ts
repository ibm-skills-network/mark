import { TextGradingStrategy } from "./text-grading.strategy";
import { hashSafetyIdentifier } from "../../../llm/core/utils/safety-identifier.util";

describe("TextGradingStrategy safety identifier", () => {
  it("sets the hashed owner id on the evaluate model", async () => {
    const strategy: any = Object.create(TextGradingStrategy.prototype);
    strategy.logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn().mockReturnThis(),
    };
    strategy.tryReuseFromConsistency = jest.fn().mockResolvedValue(null);
    strategy.recordGrading = jest.fn();
    strategy.appendRationale = jest.fn();
    let capturedModel: any;
    strategy.llmFacadeService = {
      gradeTextBasedQuestion: jest.fn().mockImplementation((model) => {
        capturedModel = model;
        return Promise.resolve({ points: 1, feedback: "ok" });
      }),
    };

    await strategy.gradeResponse(
      { question: "Q", totalPoints: 1, responseType: "OTHER", scoring: null },
      "an answer",
      {
        assignmentInstructions: "",
        questionAnswerContext: [],
        assignmentId: 1736,
        userId: "learner@example.com",
      },
    );

    expect(capturedModel.safetyIdentifier).toBe(
      hashSafetyIdentifier("learner@example.com"),
    );
  });
});
