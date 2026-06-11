/* eslint-disable */
/**
 * Tests for the token-budget gate in TextGradingService.generateGrading.
 *
 * The grader used to inject the raw learner response, unbounded previous-Q&A
 * context, and rubric JSON into the prompt with no token check, producing
 * prompts that blew past the model's context window. These tests pin the new
 * behavior:
 *
 *  1. Under budget -> the full learner response is rendered verbatim, the
 *     summarizer is never invoked, no disclosure note is added, and the invoke
 *     options pin maxRetries: 1.
 *  2. Over budget via an oversized learner response -> the response is
 *     chunk-summarized, the summary (not the raw text) is rendered, and a
 *     disclosure note is shown to the model.
 *  3. Over budget via oversized previous-Q&A context -> that context is dropped
 *     to "[]", the summarizer is NOT called, and a structured info log fires.
 */

import { TextGradingService } from "./text-grading.service";

function buildService() {
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };

  // A grading object that satisfies GradingAttemptSchema directly, so the
  // parser stub can return it without us hand-crafting JSON the classic parser
  // would have to re-parse.
  const validGrading = {
    totalScore: 4,
    maxScore: 4,
    criteria: [
      {
        criterionId: "c1",
        pointsAwarded: 4,
        maxPoints: 4,
        evidence: "some evidence",
        feedback: "met",
      },
    ],
    overallFeedback: "ok",
  };

  const service = Object.create(TextGradingService.prototype);
  service.logger = mockLogger;

  service.promptProcessor = {
    processPromptForFeature: jest.fn().mockResolvedValue("LLM_RAW_RESPONSE"),
  };

  // Char/4 token heuristic mirrors the harness contract in the task spec.
  service.contentSummarization = {
    getSafeContextLimit: jest.fn(() => 102_400),
    countTokens: jest.fn((t: string) => Math.ceil((t ?? "").length / 4)),
    summarizeTextToBudget: jest.fn(),
  };

  // Stub the parser so we never depend on the classic StructuredOutputParser
  // internals; parse() returns an object that GradingAttemptSchema accepts.
  service.getOrCreateParser = jest.fn(() => ({
    getFormatInstructions: () => "FORMAT_INSTRUCTIONS",
    parse: jest.fn().mockResolvedValue(validGrading),
  }));

  return { service, mockLogger };
}

function baseModel(overrides: Record<string, unknown> = {}) {
  return {
    question: "What is React?",
    learnerResponse: "A short answer.",
    scoringCriteriaType: "CRITERIA_BASED",
    scoringCriteria: { rubrics: [] },
    previousQuestionsAnswersContext: [],
    assignmentInstrctions: "Follow the rubric.",
    responseType: "OTHER",
    ...overrides,
  };
}

async function renderCapturedPrompt(
  processPromptForFeature: jest.Mock,
): Promise<string> {
  const capturedPrompt = processPromptForFeature.mock.calls[0][0];
  return capturedPrompt.format({});
}

describe("TextGradingService.generateGrading token budget gate", () => {
  it("renders the full learner response, skips summarization, and pins maxRetries when under budget", async () => {
    const { service } = buildService();
    const learnerResponse =
      "This is a perfectly normal learner response that fits within budget.";

    const model = baseModel({ learnerResponse });

    await (service as any).generateGrading(model, 4, "hash", 1);

    const rendered = await renderCapturedPrompt(
      service.promptProcessor.processPromptForFeature,
    );

    // Full response is present verbatim.
    expect(rendered).toContain(learnerResponse);
    // No summarization happened.
    expect(
      service.contentSummarization.summarizeTextToBudget,
    ).not.toHaveBeenCalled();
    // No disclosure note for the model.
    expect(rendered).not.toContain("summarized extract");

    // maxRetries pinned on the invoke options (6th arg).
    const call = service.promptProcessor.processPromptForFeature.mock.calls[0];
    expect(call[5]).toEqual(
      expect.objectContaining({ temperature: 0, top_p: 0, maxRetries: 1 }),
    );
  });

  it("summarizes an oversized learner response and discloses the reduction to the model", async () => {
    const { service } = buildService();
    // 600k chars / 4 = 150k tokens, over the 102_400 safe limit.
    const hugeResponse = "x".repeat(600_000);

    service.contentSummarization.summarizeTextToBudget.mockResolvedValue({
      text: "SUMMARIZED CONTENT",
      summarized: true,
      originalTokens: 150_000,
      finalTokens: 5000,
    });

    const model = baseModel({ learnerResponse: hugeResponse });

    await (service as any).generateGrading(model, 4, "hash", 1);

    expect(
      service.contentSummarization.summarizeTextToBudget,
    ).toHaveBeenCalledTimes(1);

    const args =
      service.contentSummarization.summarizeTextToBudget.mock.calls[0][0];
    expect(args.targetTokens).toBeGreaterThan(0);
    expect(args.text).toBe(hugeResponse);

    const rendered = await renderCapturedPrompt(
      service.promptProcessor.processPromptForFeature,
    );

    // The summary is rendered, the raw text is not.
    expect(rendered).toContain("SUMMARIZED CONTENT");
    expect(rendered).not.toContain(hugeResponse);
    // Disclosure note is present.
    expect(rendered).toContain("summarized extract");
  });

  it("drops oversized previous-Q&A context without summarizing the response", async () => {
    const { service, mockLogger } = buildService();
    // Build a previousQuestionsAnswersContext blob whose JSON pushes the prompt
    // over budget on its own, while the response stays tiny.
    const bigContext = Array.from({ length: 2000 }, (_, i) => ({
      question: `Q${i} ${"q".repeat(200)}`,
      answer: `A${i} ${"a".repeat(200)}`,
    }));

    const model = baseModel({
      learnerResponse: "tiny response",
      previousQuestionsAnswersContext: bigContext,
    });

    await (service as any).generateGrading(model, 4, "hash", 1);

    const rendered = await renderCapturedPrompt(
      service.promptProcessor.processPromptForFeature,
    );

    // Previous-Q&A context was dropped to an empty array in the prompt.
    expect(rendered).toContain("[]");
    expect(rendered).not.toContain("qqqqqqqqqq");

    // Response was small enough that the summarizer was never invoked.
    expect(
      service.contentSummarization.summarizeTextToBudget,
    ).not.toHaveBeenCalled();

    // Structured info log fired with the event name.
    expect(mockLogger.info).toHaveBeenCalledWith(
      "text.grading.context.dropped",
      expect.objectContaining({ assignmentId: 1 }),
    );
  });
});
