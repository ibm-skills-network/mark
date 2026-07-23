import { VideoPresentationGradingService } from "./video-grading.service";
import { VideoPresentationQuestionResponseModel } from "../../../model/video-presentation.question.response.model";

function mockLogger() {
  const logger: any = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(),
  };
  logger.child.mockReturnValue(logger);
  return logger;
}

function buildService(assessContent: jest.Mock) {
  const service: any = Object.create(VideoPresentationGradingService.prototype);
  service.logger = mockLogger();
  service.moderationService = { assessContent };
  service.promptProcessor = {
    processPromptForFeature: jest
      .fn()
      .mockResolvedValue('{"points": 3, "feedback": "ok"}'),
  };
  return { service, mockLogger: service.logger };
}

function gradeModel() {
  return {
    question: "Present your findings",
    learnerResponse: { transcript: "my presentation transcript" },
    totalPoints: 5,
    scoringCriteriaType: "OTHER",
    scoringCriteria: { rubrics: [] },
    previousQuestionsAnswersContext: [],
    assignmentInstrctions: "",
    questionType: "TEXT",
    responseType: "PRESENTATION",
    videoPresentationConfig: {
      evaluateSlidesQuality: false,
      evaluateTimeManagement: false,
      targetTime: 5,
    },
  };
}

describe("VideoPresentationGradingService moderation verdicts", () => {
  it("returns a 0-point result without calling the LLM on a severe flag", async () => {
    const assessContent = jest.fn().mockResolvedValue({
      action: "block_severe",
      flaggedCategories: ["sexual/minors"],
      severeCategories: ["sexual/minors"],
    });
    const { service, mockLogger } = buildService(assessContent);

    const result = await (service as any).gradeVideoPresentationQuestion(
      gradeModel(),
      1736,
    );

    expect(result.points).toBe(0);
    expect(result.feedback).toContain("flagged by automated content review");
    expect(
      service.promptProcessor.processPromptForFeature,
    ).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "grading.moderation.blocked_severe",
      expect.objectContaining({ assignmentId: 1736 }),
    );
  });

  it("logs and proceeds on an ordinary flag", async () => {
    const assessContent = jest.fn().mockResolvedValue({
      action: "allow_with_log",
      flaggedCategories: ["violence"],
      severeCategories: [],
    });
    const { service, mockLogger } = buildService(assessContent);

    await (service as any)
      .gradeVideoPresentationQuestion(gradeModel(), 1736)
      .catch(() => undefined); // downstream parse may fail; moderation is what's under test

    expect(service.promptProcessor.processPromptForFeature).toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "grading.moderation.flagged",
      expect.objectContaining({ categories: ["violence"] }),
    );
  });
});
