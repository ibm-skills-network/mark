import { FileGradingService } from "./file-grading.service";

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
  const service: any = Object.create(FileGradingService.prototype);
  service.logger = mockLogger();
  service.moderationService = { assessContent };
  service.promptProcessor = {
    processPrompt: jest.fn(),
    processPromptForFeature: jest.fn(),
  };
  return { service, mockLogger: service.logger };
}

function gradeModel() {
  return {
    question: "Upload your report",
    learnerResponse: [{ content: "chapter one" }, { content: "chapter two" }],
    totalPoints: 10,
    scoringCriteriaType: "OTHER",
    scoringCriteria: { rubrics: [] },
    previousQuestionsAnswersContext: [],
    assignmentInstrctions: "",
    questionType: "UPLOAD",
    responseType: "REPORT",
  };
}

describe("FileGradingService moderation verdicts", () => {
  it("no longer throws a 400 on a moderation flag", async () => {
    const assessContent = jest.fn().mockResolvedValue({
      action: "allow_with_log",
      flaggedCategories: ["violence"],
      severeCategories: [],
    });
    const { service, mockLogger } = buildService(assessContent);

    await (service as any)
      .gradeFileBasedQuestion(gradeModel(), 1736)
      .catch((error: Error) => {
        expect(error.message).not.toBe("Learner response validation failed");
      });

    expect(assessContent).toHaveBeenCalledWith("chapter one chapter two");
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "grading.moderation.flagged",
      expect.objectContaining({ assignmentId: 1736 }),
    );
  });

  it("returns a 0-point result without calling the LLM on a severe flag", async () => {
    const assessContent = jest.fn().mockResolvedValue({
      action: "block_severe",
      flaggedCategories: ["sexual/minors"],
      severeCategories: ["sexual/minors"],
    });
    const { service } = buildService(assessContent);

    const result = await (service as any).gradeFileBasedQuestion(
      gradeModel(),
      1736,
    );

    expect(result.points).toBe(0);
    expect(result.feedback).toContain("flagged by automated content review");
    expect(service.promptProcessor.processPrompt).not.toHaveBeenCalled();
    expect(
      service.promptProcessor.processPromptForFeature,
    ).not.toHaveBeenCalled();
  });
});
