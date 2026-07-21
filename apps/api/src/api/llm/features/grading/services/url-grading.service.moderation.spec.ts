import { UrlGradingService } from "./url-grading.service";

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
  const service: any = Object.create(UrlGradingService.prototype);
  service.logger = mockLogger();
  service.moderationService = { assessContent };
  service.promptProcessor = { processPromptForFeature: jest.fn() };
  return { service, mockLogger: service.logger };
}

function gradeModel() {
  return {
    question: "Link your project",
    urlProvided: "https://example.com/project",
    isUrlFunctional: true,
    urlBody: "<html>project</html>",
    totalPoints: 5,
    scoringCriteriaType: "OTHER",
    scoringCriteria: { rubrics: [] },
    previousQuestionsAnswersContext: [],
    assignmentInstrctions: "",
    responseType: "OTHER",
  };
}

describe("UrlGradingService moderation verdicts", () => {
  it("returns a 0-point result without calling the LLM on a severe flag", async () => {
    const assessContent = jest.fn().mockResolvedValue({
      action: "block_severe",
      flaggedCategories: ["sexual/minors"],
      severeCategories: ["sexual/minors"],
    });
    const { service, mockLogger } = buildService(assessContent);

    const result = await (service as any).gradeUrlBasedQuestion(
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

  it("does not throw on an ordinary flag", async () => {
    const assessContent = jest.fn().mockResolvedValue({
      action: "allow_with_log",
      flaggedCategories: ["violence"],
      severeCategories: [],
    });
    const { service, mockLogger } = buildService(assessContent);

    await (service as any)
      .gradeUrlBasedQuestion(gradeModel(), 1736)
      .catch((error: Error) => {
        expect(error.message).not.toBe("Learner response validation failed");
      });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      "grading.moderation.flagged",
      expect.objectContaining({ categories: ["violence"] }),
    );
  });
});
