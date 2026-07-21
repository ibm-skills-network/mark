import { FileGradingStrategy } from "./file-grading.strategy";
import { FileBasedQuestionResponseModel } from "../../../llm/model/file.based.question.response.model";
import { MODERATION_BLOCK_FEEDBACK } from "../../../llm/features/grading/constants";

function mockLogger() {
  const logger: any = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };
  return logger;
}

describe("FileGradingStrategy moderation short-circuit", () => {
  it("does not run the judge loop when the facade returns a moderation-blocked result", async () => {
    const strategy: any = Object.create(FileGradingStrategy.prototype);
    strategy.logger = mockLogger();
    strategy.recordGrading = jest.fn();

    strategy.fileContentExtractionService = {
      extractContentFromFiles: jest.fn().mockResolvedValue([
        {
          filename: "essay.txt",
          content: "learner content",
          fileType: "text/plain",
          metadata: { size: 42 },
        },
      ]),
    };

    // The facade already applied the severe verdict and marked the result so
    // downstream steps know not to re-send this content to a completion model.
    const blockedModel = new FileBasedQuestionResponseModel(
      0,
      MODERATION_BLOCK_FEEDBACK,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { moderationBlocked: true },
    );
    strategy.llmFacadeService = {
      gradeFileBasedQuestion: jest.fn().mockResolvedValue(blockedModel),
    };

    const validateGrading = jest.fn();
    strategy.gradingJudgeService = { validateGrading };

    const question = {
      id: 99,
      question: "Upload your report",
      totalPoints: 10,
      scoring: null,
      type: "UPLOAD",
      responseType: "REPORT",
    };

    const learnerResponse = [
      {
        filename: "essay.txt",
        content: "learner content",
        key: "k",
        bucket: "b",
      },
    ];

    const responseDto = await strategy.gradeResponse(
      question,
      learnerResponse,
      {
        assignmentInstructions: "",
        questionAnswerContext: [],
        assignmentId: 1736,
        userId: "learner@example.com",
      },
    );

    expect(validateGrading).not.toHaveBeenCalled();
    expect(
      strategy.llmFacadeService.gradeFileBasedQuestion,
    ).toHaveBeenCalledTimes(1);
    expect(responseDto.totalPoints).toBe(0);
    expect(responseDto.feedback[0].feedback).toBe(MODERATION_BLOCK_FEEDBACK);
  });
});
