import { ImageGradingService } from "./image-grading.service";

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
  const service: any = Object.create(ImageGradingService.prototype);
  service.logger = mockLogger();
  service.moderationService = { assessContent };
  service.promptProcessor = {
    processPromptWithImage: jest.fn().mockResolvedValue("{}"),
  };
  service.llmResolver = {
    getModelKeyWithFallback: jest.fn().mockResolvedValue("gpt-4.1-mini"),
  };
  return { service, mockLogger: service.logger };
}

function gradeModel() {
  return {
    question: "Draw a diagram",
    imageData: "data:image/png;base64,AAAA",
    learnerResponse: "my diagram",
    totalPoints: 5,
    scoringCriteriaType: "OTHER",
    scoringCriteria: { rubrics: [] },
    previousQuestionsAnswersContext: [],
    assignmentInstrctions: "",
    learnerImageResponse: [],
  };
}

describe("ImageGradingService moderation verdicts", () => {
  it("passes the image urls to moderation", async () => {
    const assessContent = jest.fn().mockResolvedValue({
      action: "block_severe",
      flaggedCategories: ["sexual/minors"],
      severeCategories: ["sexual/minors"],
    });
    const { service } = buildService(assessContent);

    await (service as any).gradeImageBasedQuestion(gradeModel(), 1736);

    expect(assessContent).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["data:image/png;base64,AAAA"]),
    );
  });

  it("returns a 0-point result without invoking the vision model on a severe flag", async () => {
    const assessContent = jest.fn().mockResolvedValue({
      action: "block_severe",
      flaggedCategories: ["sexual/minors"],
      severeCategories: ["sexual/minors"],
    });
    const { service, mockLogger } = buildService(assessContent);

    const result = await (service as any).gradeImageBasedQuestion(
      gradeModel(),
      1736,
    );

    expect(result.points).toBe(0);
    expect(result.feedback).toContain("flagged by automated content review");
    expect(
      service.promptProcessor.processPromptWithImage,
    ).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "grading.moderation.blocked_severe",
      expect.objectContaining({ assignmentId: 1736 }),
    );
  });
});
