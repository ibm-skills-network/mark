import { AIUsageType } from "@prisma/client";
import type { Logger } from "winston";
import type { IPromptProcessor } from "../../../core/interfaces/prompt-processor.interface";
import type { ITokenCounter } from "../../../core/interfaces/token-counter.interface";
import { ContentSummarizationService } from "./content-summarization.service";

// Token counter mock: ~4 chars/token, matching the real BPE approximation the
// service's own char-per-token heuristics assume.
function buildMocks() {
  const mockTokenCounter: ITokenCounter = {
    countTokens: jest.fn((text: string) => Math.ceil(text.length / 4)),
  };
  const mockPromptProcessor: IPromptProcessor = {
    processPromptForFeature: jest.fn(),
    processPrompt: jest.fn(),
    processPromptWithImage: jest.fn(),
  };
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  } as unknown as Logger;

  const service = new ContentSummarizationService(
    mockTokenCounter,
    mockPromptProcessor,
    mockLogger,
  );

  return { service, mockTokenCounter, mockPromptProcessor, mockLogger };
}

describe("ContentSummarizationService.getSafeContextLimit", () => {
  it("applies the 0.8 safety ratio to a known model's 128k window", () => {
    const { service } = buildMocks();
    // 128_000 * 0.8 = 102_400
    expect(service.getSafeContextLimit("gpt-4o-mini")).toBe(102_400);
  });

  it("falls back to the default 32k window for an unknown model", () => {
    const { service } = buildMocks();
    // 32_000 * 0.8 = 25_600
    expect(service.getSafeContextLimit("some-unknown-model")).toBe(25_600);
  });

  // Every "gpt-5.6-*" key also contains "gpt-5"; the specific entry must win.
  it.each(["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"])(
    "gives %s its 1.05M window, not the gpt-5 128k window",
    (modelKey) => {
      const { service } = buildMocks();
      expect(service.getContextWindow(modelKey)).toBe(1_050_000);

      const safeLimit = service.getSafeContextLimit(modelKey);
      expect(safeLimit).toBe(840_000);
      expect(safeLimit).toBeLessThan(922_000);
    },
  );
});

describe("ContentSummarizationService.splitTextIntoChunks", () => {
  it("keeps every chunk within the token cap and reassembles to ~the input", () => {
    const { service } = buildMocks();
    // ~100k chars => ~25k tokens at 4 chars/token.
    const input = "abcd ".repeat(20_000); // 100_000 chars
    const cap = 20_000;

    const chunks = service.splitTextIntoChunks(input, cap);

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(Math.ceil(chunk.length / 4)).toBeLessThanOrEqual(cap);
    }

    const reassembled = chunks.join("");
    const lengthDelta = Math.abs(reassembled.length - input.length);
    expect(lengthDelta).toBeLessThanOrEqual(input.length * 0.01);
  });
});

describe("ContentSummarizationService.truncateToTokenLimit", () => {
  it("returns a prefix of the input within the token limit", () => {
    const { service } = buildMocks();
    const input = "x".repeat(50_000); // ~12_500 tokens
    const limit = 1000;

    const result = service.truncateToTokenLimit(input, limit);

    expect(Math.ceil(result.length / 4)).toBeLessThanOrEqual(limit);
    expect(input.startsWith(result)).toBe(true);
  });
});

describe("ContentSummarizationService.summarizeTextToBudget", () => {
  it("returns the text unchanged and never calls the LLM when under budget", async () => {
    const { service, mockPromptProcessor } = buildMocks();
    const text = "short content"; // ~4 tokens

    const result = await service.summarizeTextToBudget({
      text,
      label: "answer.txt",
      questionText: "What is 2+2?",
      modelKey: "gpt-4o-mini",
      assignmentId: 1,
      usageType: AIUsageType.ASSIGNMENT_GRADING,
      feature: "text_grading",
      targetTokens: 1000,
    });

    expect(result.summarized).toBe(false);
    expect(result.text).toBe(text);
    expect(result.originalTokens).toBe(result.finalTokens);
    expect(mockPromptProcessor.processPromptForFeature).not.toHaveBeenCalled();
  });

  it("summarizes, calls the LLM, and stays within the target when over budget", async () => {
    const { service, mockPromptProcessor } = buildMocks();
    (
      mockPromptProcessor.processPromptForFeature as jest.Mock
    ).mockResolvedValue("summary text");

    const text = "abcd ".repeat(20_000); // ~25k tokens, well over budget

    const result = await service.summarizeTextToBudget({
      text,
      label: "answer.txt",
      questionText: "Explain the topic.",
      modelKey: "gpt-4o-mini",
      assignmentId: 1,
      usageType: AIUsageType.ASSIGNMENT_GRADING,
      feature: "text_grading",
      targetTokens: 1000,
    });

    expect(result.summarized).toBe(true);
    expect(
      (mockPromptProcessor.processPromptForFeature as jest.Mock).mock.calls
        .length,
    ).toBeGreaterThanOrEqual(1);
    expect(result.finalTokens).toBeLessThanOrEqual(1000);
    expect(result.originalTokens).toBeGreaterThan(result.finalTokens);
  });

  // (a) A non-positive token budget must fail fast BEFORE any LLM call rather
  // than burning the chunk-summarization budget and returning empty text that
  // would then be graded as the submission.
  it("throws before any LLM call and logs when targetTokens <= 0", async () => {
    const { service, mockPromptProcessor, mockLogger } = buildMocks();
    const text = "abcd ".repeat(5000); // non-empty, ~6.25k tokens

    await expect(
      service.summarizeTextToBudget({
        text,
        label: "learner response",
        questionText: "Explain the topic.",
        modelKey: "gpt-4o-mini",
        assignmentId: 1,
        usageType: AIUsageType.ASSIGNMENT_GRADING,
        feature: "text_grading",
        targetTokens: 0,
      }),
    ).rejects.toThrow(/no token budget/i);

    expect(mockPromptProcessor.processPromptForFeature).not.toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith(
      "content.summarization.invalid.budget",
      expect.objectContaining({
        label: "learner response",
        targetTokens: 0,
      }),
    );
  });

  // (b) A single chunk's summarize call failing must not abort the pipeline:
  // the per-chunk catch substitutes a raw excerpt and the result stays bounded.
  it("substitutes a raw excerpt when one chunk's summarize call rejects and stays bounded", async () => {
    const { service, mockPromptProcessor } = buildMocks();
    const processMock =
      mockPromptProcessor.processPromptForFeature as jest.Mock;
    processMock
      .mockRejectedValueOnce(new Error("transient LLM failure"))
      .mockResolvedValue("summary text");

    const text = "abcd ".repeat(20_000); // ~25k tokens, over budget

    const result = await service.summarizeTextToBudget({
      text,
      label: "answer.txt",
      questionText: "Explain the topic.",
      modelKey: "gpt-4o-mini",
      assignmentId: 1,
      usageType: AIUsageType.ASSIGNMENT_GRADING,
      feature: "text_grading",
      targetTokens: 1000,
    });

    expect(result.summarized).toBe(true);
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.finalTokens).toBeLessThanOrEqual(1000);
  });

  // (c) When the joined chunk summaries are themselves over budget, the compress
  // pass must engage and the final result must still be bounded.
  it("engages the compress pass when joined summaries exceed budget and stays bounded", async () => {
    const { service, mockPromptProcessor } = buildMocks();
    const processMock =
      mockPromptProcessor.processPromptForFeature as jest.Mock;
    // Long per-chunk summaries (~5k tokens each) so the joined text is well over
    // the 1000-token budget and compress is forced.
    const longSummary = "word ".repeat(4000); // ~5k tokens
    processMock.mockImplementation(() => Promise.resolve(longSummary));

    const text = "abcd ".repeat(40_000); // ~50k tokens => multiple chunks

    const result = await service.summarizeTextToBudget({
      text,
      label: "answer.txt",
      questionText: "Explain the topic.",
      modelKey: "gpt-4o-mini",
      assignmentId: 1,
      usageType: AIUsageType.ASSIGNMENT_GRADING,
      feature: "text_grading",
      targetTokens: 1000,
    });

    // The compress prompt ("compressing grading notes") must have been called.
    const compressCalled = processMock.mock.calls.some((call) => {
      const prompt = call[0] as { template?: string };
      return (
        typeof prompt?.template === "string" &&
        prompt.template.includes("compressing grading notes")
      );
    });
    expect(compressCalled).toBe(true);
    expect(result.summarized).toBe(true);
    expect(result.finalTokens).toBeLessThanOrEqual(1000);
  });

  // (d) Adversarially large inputs must not fan out into unbounded summarize
  // calls: only the first MAX_SUMMARY_CHUNKS are summarized, an omission marker
  // is appended, and the cap is recorded in the structured engagement log.
  it("caps chunk fan-out at MAX_SUMMARY_CHUNKS and discloses the omission", async () => {
    const { service, mockPromptProcessor, mockLogger } = buildMocks();
    const processMock =
      mockPromptProcessor.processPromptForFeature as jest.Mock;
    processMock.mockResolvedValue("s");

    // chunkTokenLimit for targetTokens=100_000 is max(4000, min(20_000, 20_000))
    // = 20_000 tokens (~80_000 chars/chunk). 30 chunks => ~2.4M chars.
    const text = "abcd ".repeat(600_000); // ~3M chars => > 25 chunks

    const result = await service.summarizeTextToBudget({
      text,
      label: "answer.txt",
      questionText: "Explain the topic.",
      modelKey: "gpt-4o-mini",
      assignmentId: 1,
      usageType: AIUsageType.ASSIGNMENT_GRADING,
      feature: "text_grading",
      targetTokens: 100_000,
    });

    // Exactly 25 summarize calls; the omitted tail is NOT sent to the LLM.
    const summarizeCalls = processMock.mock.calls.filter((call) => {
      const prompt = call[0] as { template?: string };
      return (
        typeof prompt?.template === "string" &&
        prompt.template.includes("condensing a learner submission chunk")
      );
    });
    expect(summarizeCalls.length).toBe(25);
    expect(result.text).toContain("remaining content omitted");
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "content.summarization.engaged",
      expect.objectContaining({
        label: "answer.txt",
        cappedAtMaxChunks: true,
      }),
    );
  });
});
