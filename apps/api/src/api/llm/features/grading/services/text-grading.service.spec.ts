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

  // Native structured output returns the validated grading object directly,
  // so the mock resolves to the object the schema would produce.
  service.promptProcessor = {
    processStructuredPromptForFeature: jest
      .fn()
      .mockResolvedValue(validGrading),
  };

  // Char/4 heuristic approximates the tokenizer for budget math.
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
  processStructuredPromptForFeature: jest.Mock,
): Promise<string> {
  const capturedPrompt = processStructuredPromptForFeature.mock.calls[0][0];
  return capturedPrompt.format({});
}

describe("TextGradingService.generateGrading structured output", () => {
  it("returns the validated grading object from native structured output", async () => {
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

    const mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn().mockReturnThis(),
    };
    const service: any = Object.create(TextGradingService.prototype);
    service.logger = mockLogger;

    const processStructuredPromptForFeature = jest
      .fn()
      .mockResolvedValue(validGrading);
    service.promptProcessor = { processStructuredPromptForFeature };
    service.contentSummarization = {
      getSafeContextLimit: jest.fn(() => 102_400),
      countTokens: jest.fn((t: string) => Math.ceil((t ?? "").length / 4)),
      summarizeTextToBudget: jest.fn(),
    };
    service.getOrCreateParser = jest.fn(() => ({
      getFormatInstructions: () => "FORMAT_INSTRUCTIONS",
      parse: jest.fn(),
    }));

    // A code answer containing raw JSON with unescaped quotes — the exact shape
    // that broke the old free-form-JSON parse. With structured output the model
    // returns a validated object, so this can no longer fail to parse.
    const model = baseModel({
      learnerResponse: 'curl http://x/title/Foo\n[{"author":"Unknown"}]',
      responseType: "CODE",
    });

    const result = await service.generateGrading(model, 4, "hash", 1);

    expect(result).toEqual(validGrading);
    expect(processStructuredPromptForFeature).toHaveBeenCalledTimes(1);
    const call = processStructuredPromptForFeature.mock.calls[0];
    expect(call[3]).toBe("text_grading"); // featureKey
    expect(call[4]).toBeDefined(); // schema
    expect(call[6]).toEqual(
      expect.objectContaining({ temperature: 0, top_p: 0, maxRetries: 1 }),
    ); // invoke options
  });
});

describe("TextGradingService.generateGrading token budget gate", () => {
  it("renders the full learner response, skips summarization, and pins maxRetries when under budget", async () => {
    const { service } = buildService();
    const learnerResponse =
      "This is a perfectly normal learner response that fits within budget.";

    const model = baseModel({ learnerResponse });

    await (service as any).generateGrading(model, 4, "hash", 1);

    const rendered = await renderCapturedPrompt(
      service.promptProcessor.processStructuredPromptForFeature,
    );

    // Full response is present verbatim.
    expect(rendered).toContain(learnerResponse);
    // No summarization happened.
    expect(
      service.contentSummarization.summarizeTextToBudget,
    ).not.toHaveBeenCalled();
    // No disclosure note for the model.
    expect(rendered).not.toContain("summarized extract");

    // maxRetries pinned on the invoke options (7th arg: prompt, assignmentId,
    // usageType, featureKey, schema, fallbackModel, options).
    const call =
      service.promptProcessor.processStructuredPromptForFeature.mock.calls[0];
    expect(call[6]).toEqual(
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
      service.promptProcessor.processStructuredPromptForFeature,
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
      service.promptProcessor.processStructuredPromptForFeature,
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

/**
 * The Path B retry loop in gradeTextBasedQuestion must not resend an identical
 * prompt after a context_length_exceeded 400 — that error is deterministic, so
 * the loop has to break immediately and let the post-loop failure throw fire.
 *
 * NOTE on call counts: the loop is `while (!gradingAttempt && attemptCount <
 * this.maxRetries)` with `this.maxRetries = 1`, so generateGrading (and the
 * single processStructured inside it) is invoked exactly ONCE per grade
 * even on a generic error. The context-length fail-fast therefore does not
 * reduce the invoke count here; what it adds is the structured error log and an
 * immediate break (so no backoff and no re-entry if maxRetries were raised).
 * Both tests assert exactly one invoke and a rejection; they differ on whether
 * the context-length event log fires.
 */
describe("TextGradingService.gradeTextBasedQuestion context-length fail-fast", () => {
  function buildGradeService(processStructured: jest.Mock) {
    const { service, mockLogger } = buildService();
    // Object.create skips class field initializers, so restore the retry
    // configuration the loop reads.
    service.maxRetries = 1;
    service.retryDelay = 1000;
    service.promptProcessor = {
      processStructuredPromptForFeature: processStructured,
    };
    service.moderationService = {
      validateContent: jest.fn().mockResolvedValue(true),
    };
    // No normalization / cache / judge needed to reach the loop, but the judge
    // is referenced after a successful grade; these paths are never hit here
    // because generateGrading always rejects.
    service.gradingJudgeService = { validateGrading: jest.fn() };
    return { service, mockLogger };
  }

  function gradeModel(learnerResponse: string) {
    return {
      question: "What is React?",
      learnerResponse,
      totalPoints: 4,
      scoringCriteriaType: "OTHER",
      scoringCriteria: { rubrics: [] },
      previousQuestionsAnswersContext: [],
      assignmentInstrctions: "Follow the rubric.",
      responseType: "OTHER",
      questionId: 7,
    };
  }

  it("does not re-enter the loop on a context-length error and rejects", async () => {
    const contextError = new Error(
      "This model's maximum context length is 128000 tokens. " +
        "However, your messages resulted in 159000 tokens.",
    );
    const processStructured = jest.fn().mockRejectedValue(contextError);
    const { service, mockLogger } = buildGradeService(processStructured);

    await expect(
      (service as any).gradeTextBasedQuestion(gradeModel("a short answer"), 42),
    ).rejects.toThrow();

    // The loop did not re-enter: exactly one underlying LLM call.
    expect(processStructured).toHaveBeenCalledTimes(1);

    // The fail-fast structured error log fired with the event name.
    expect(mockLogger.error).toHaveBeenCalledWith(
      "text.grading.context.length.exceeded",
      expect.objectContaining({ assignmentId: 42, attempt: 1 }),
    );
  });

  it("uses the normal retry budget for a generic error (no context-length log)", async () => {
    const processStructured = jest
      .fn()
      .mockRejectedValue(new Error("Rate limit reached for gpt-4o-mini"));
    const { service, mockLogger } = buildGradeService(processStructured);

    await expect(
      (service as any).gradeTextBasedQuestion(gradeModel("a short answer"), 42),
    ).rejects.toThrow();

    // maxRetries = 1 -> the loop runs exactly once even on a generic error.
    expect(processStructured).toHaveBeenCalledTimes(1);

    // No context-length event log for a non-context-length error.
    expect(mockLogger.error).not.toHaveBeenCalledWith(
      "text.grading.context.length.exceeded",
      expect.anything(),
    );
  });

  // With maxRetries = 1 the loop runs once regardless, so the break is invisible
  // at the shipped ceiling. Raise the ceiling to expose the break: a
  // context-length error must short-circuit to a single call, while a generic
  // error exhausts the full budget of three. This pins the break against
  // regression if the ceiling is ever raised.
  it("breaks the retry loop on a context-length error even when the ceiling is raised", async () => {
    const contextError = new Error(
      "This model's maximum context length is 128000 tokens. " +
        "However, your messages resulted in 159000 tokens.",
    );
    const processStructured = jest.fn().mockRejectedValue(contextError);
    const { service } = buildGradeService(processStructured);
    service.maxRetries = 3;
    service.retryDelay = 0;

    await expect(
      (service as any).gradeTextBasedQuestion(gradeModel("a short answer"), 42),
    ).rejects.toThrow();

    // Context-length errors are deterministic: the break stops re-entry, so the
    // raised ceiling never produces a second call.
    expect(processStructured).toHaveBeenCalledTimes(1);
  });

  it("exhausts the raised retry budget for a generic error (control)", async () => {
    const processStructured = jest
      .fn()
      .mockRejectedValue(new Error("Rate limit reached for gpt-4o-mini"));
    const { service } = buildGradeService(processStructured);
    service.maxRetries = 3;
    service.retryDelay = 0;

    await expect(
      (service as any).gradeTextBasedQuestion(gradeModel("a short answer"), 42),
    ).rejects.toThrow();

    // A generic error keeps retrying, so the loop uses the full raised budget.
    expect(processStructured).toHaveBeenCalledTimes(3);
  });
});
