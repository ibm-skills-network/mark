/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { PresentationGradingService } from "./presentation-grading.service";

function mockLogger(): any {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(),
  };
  logger.child.mockReturnValue(logger);
  return logger;
}

function buildService(assessContent: jest.Mock): any {
  const service = Object.create(PresentationGradingService.prototype);
  service.logger = mockLogger();
  service.moderationService = { assessContent };
  service.promptProcessor = { processPromptForFeature: jest.fn() };
  return { service, mockLogger: service.logger };
}

function gradeModel(transcript?: string): any {
  return {
    question: "Present your findings",
    learnerResponse: { transcript },
    totalPoints: 5,
    scoringCriteriaType: "OTHER",
    scoringCriteria: { rubrics: [] },
    previousQuestionsAnswersContext: [],
    assignmentInstrctions: "",
    questionType: "TEXT",
    responseType: "PRESENTATION",
  };
}

describe("PresentationGradingService moderation verdicts", () => {
  it("returns a 0-point result without calling the LLM on a severe flag", async () => {
    const assessContent = jest.fn().mockResolvedValue({
      action: "block_severe",
      flaggedCategories: ["sexual/minors"],
      severeCategories: ["sexual/minors"],
    });
    const { service, mockLogger } = buildService(assessContent);

    const result = await (service as any).gradePresentationQuestion(
      gradeModel("a transcript"),
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

  it("skips moderation when there is no transcript", async () => {
    const assessContent = jest.fn();
    const { service } = buildService(assessContent);

    await (service as any)
      .gradePresentationQuestion(gradeModel(undefined), 1736)
      .catch(() => undefined);

    expect(assessContent).not.toHaveBeenCalled();
  });
});
