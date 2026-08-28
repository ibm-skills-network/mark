import { PromptTemplate } from "@langchain/core/prompts";
import { AIUsageType } from "@prisma/client";
import { z } from "zod";
import { PromptProcessorService } from "./prompt-processor.service";

describe("PromptProcessorService", () => {
  const logger = {
    error: jest.fn(),
    info: jest.fn(),
  };
  const parentLogger = {
    child: jest.fn(),
  };
  const usageTracker = {
    trackUsage: jest.fn(),
  };
  const aiFlags = {
    assertUsageEnabled: jest.fn(),
  };
  const llm = {
    key: "gpt-4o-mini",
    invoke: jest.fn(),
  };
  const router = {
    get: jest.fn(),
    getForFeatureWithFallback: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    parentLogger.child.mockReturnValue(logger);
    router.get.mockReturnValue(llm);
  });

  it("returns the provider response even when usage tracking fails", async () => {
    llm.invoke.mockResolvedValue({
      content: '```json\n{"grade": 1}\n```',
      tokenUsage: { input: 17, output: 31 },
    });
    usageTracker.trackUsage.mockRejectedValue(new Error("write failed"));
    const service = new PromptProcessorService(
      router as any,
      usageTracker as any,
      aiFlags as any,
      parentLogger as any,
    );

    await expect(
      service.processPrompt(
        "grade this",
        55,
        AIUsageType.ASSIGNMENT_GRADING,
        "gpt-4o-mini",
      ),
    ).resolves.toBe('{"grade": 1}');

    expect(usageTracker.trackUsage).toHaveBeenCalledWith(
      55,
      AIUsageType.ASSIGNMENT_GRADING,
      17,
      31,
      "gpt-4o-mini",
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "AI usage tracking failed after successful provider response",
      ),
    );
  });

  it("still fails when the provider invocation itself fails", async () => {
    llm.invoke.mockRejectedValue(new Error("provider down"));
    const service = new PromptProcessorService(
      router as any,
      usageTracker as any,
      aiFlags as any,
      parentLogger as any,
    );

    await expect(
      service.processPrompt(
        "grade this",
        55,
        AIUsageType.ASSIGNMENT_GRADING,
        "gpt-4o-mini",
      ),
    ).rejects.toThrow("provider down");
  });

  it("never touches the provider when the kill-switch backstop throws", async () => {
    aiFlags.assertUsageEnabled.mockImplementation(() => {
      throw new Error("AI disabled");
    });
    const service = new PromptProcessorService(
      router as any,
      usageTracker as any,
      aiFlags as any,
      parentLogger as any,
    );

    await expect(
      service.processPrompt(
        "grade this",
        55,
        AIUsageType.ASSIGNMENT_GRADING,
        "gpt-4o-mini",
      ),
    ).rejects.toThrow("AI disabled");

    expect(router.get).not.toHaveBeenCalled();
    expect(llm.invoke).not.toHaveBeenCalled();
    expect(usageTracker.trackUsage).not.toHaveBeenCalled();
  });
});

describe("PromptProcessorService.processStructuredPromptForFeature", () => {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
  const parentLogger = { child: jest.fn() };
  const usageTracker = { trackUsage: jest.fn() };
  const aiFlags = { assertUsageEnabled: jest.fn() };
  const router = {
    get: jest.fn(),
    getForFeatureWithFallback: jest.fn(),
  };

  const schema = z.object({ grade: z.number() });

  const makeService = () =>
    new PromptProcessorService(
      router as any,
      usageTracker as any,
      aiFlags as any,
      parentLogger as any,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    parentLogger.child.mockReturnValue(logger);
    usageTracker.trackUsage.mockResolvedValue(undefined);
  });

  it("uses the provider's native structured output and returns the parsed object", async () => {
    const invokeStructured = jest.fn().mockResolvedValue({
      parsed: { grade: 4 },
      tokenUsage: { input: 10, output: 5, cachedInput: 7 },
    });
    const llm = { key: "gpt-4o-mini", invoke: jest.fn(), invokeStructured };
    router.getForFeatureWithFallback.mockResolvedValue(llm);
    const service = makeService();

    const result = await service.processStructuredPromptForFeature(
      PromptTemplate.fromTemplate("grade this"),
      77,
      AIUsageType.ASSIGNMENT_GRADING,
      "text_grading",
      schema,
      "gpt-4o-mini",
      { temperature: 0 },
    );

    expect(result).toEqual({ grade: 4 });
    expect(logger.info).toHaveBeenCalledWith(
      '[gpt-4o-mini] TEXT_GRADING - grade this ; {"grade":4}',
      expect.objectContaining({
        ai_invocation: true,
        model: "gpt-4o-mini",
        purpose: "TEXT_GRADING",
        assignment_id: 77,
        // Cache behaviour is otherwise invisible: a too-short or drifted
        // prefix still returns 200 and only the bill changes, so the log
        // line is the only place a deploy can be checked.
        input_tokens: 10,
        output_tokens: 5,
        cached_input_tokens: 7,
      }),
    );
    // The string path that does the brittle JSON.parse must NOT be used.
    expect(llm.invoke).not.toHaveBeenCalled();
    expect(invokeStructured).toHaveBeenCalledTimes(1);
    const [messages, passedSchema] = invokeStructured.mock.calls[0];
    expect(messages[0].content).toBe("grade this");
    expect(passedSchema).toBe(schema);
    expect(usageTracker.trackUsage).toHaveBeenCalledWith(
      77,
      AIUsageType.ASSIGNMENT_GRADING,
      10,
      5,
      "gpt-4o-mini",
    );
  });

  it("falls back to text parsing for providers without native structured output", async () => {
    const llm = {
      key: "granite-4-h-small",
      invoke: jest.fn().mockResolvedValue({
        content: '{"grade": 2}',
        tokenUsage: { input: 3, output: 4 },
      }),
    };
    router.getForFeatureWithFallback.mockResolvedValue(llm);
    const service = makeService();

    const result = await service.processStructuredPromptForFeature(
      PromptTemplate.fromTemplate("grade this"),
      88,
      AIUsageType.ASSIGNMENT_GRADING,
      "text_grading",
      schema,
      "gpt-4o-mini",
    );

    expect(result).toEqual({ grade: 2 });
    expect(llm.invoke).toHaveBeenCalledTimes(1);
    expect(usageTracker.trackUsage).toHaveBeenCalledWith(
      88,
      AIUsageType.ASSIGNMENT_GRADING,
      3,
      4,
      "granite-4-h-small",
    );
  });

  it("appends format instructions and salvages control chars on the text fallback", async () => {
    // The template no longer carries {format_instructions}; the fallback must
    // add them for the text-parsing provider. And a raw control char inside a
    // string (the exact code-submission failure mode) must still parse.
    const codeSchema = z.object({ grade: z.number(), code: z.string() });
    const llm = {
      key: "granite-4-h-small",
      invoke: jest.fn().mockResolvedValue({
        content: '{"grade": 2, "code": "a\nb"}',
        tokenUsage: { input: 3, output: 4 },
      }),
    };
    router.getForFeatureWithFallback.mockResolvedValue(llm);
    const service = makeService();

    const result = await service.processStructuredPromptForFeature(
      PromptTemplate.fromTemplate("grade this"),
      88,
      AIUsageType.ASSIGNMENT_GRADING,
      "text_grading",
      codeSchema,
      "gpt-4o-mini",
    );

    expect(result).toEqual({ grade: 2, code: "a\nb" });
    // The prompt sent to the provider carried appended schema instructions.
    const sentPrompt = llm.invoke.mock.calls[0][0][0].content as string;
    expect(sentPrompt).toContain("grade this");
    expect(sentPrompt.toLowerCase()).toContain("json");
  });
});

describe("PromptProcessorService.processStructuredPromptWithImage", () => {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
  const parentLogger = { child: jest.fn() };
  const usageTracker = { trackUsage: jest.fn() };
  const aiFlags = { assertUsageEnabled: jest.fn() };
  const router = { get: jest.fn(), getForFeatureWithFallback: jest.fn() };

  const schema = z.object({ grade: z.number() });

  const makeService = () =>
    new PromptProcessorService(
      router as any,
      usageTracker as any,
      aiFlags as any,
      parentLogger as any,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    parentLogger.child.mockReturnValue(logger);
    usageTracker.trackUsage.mockResolvedValue(undefined);
  });

  it("uses the provider's native multimodal structured output", async () => {
    const invokeStructuredWithImage = jest.fn().mockResolvedValue({
      parsed: { grade: 4 },
      tokenUsage: { input: 12, output: 6 },
    });
    const llm = {
      key: "gpt-4.1-mini",
      invokeWithImage: jest.fn(),
      invokeStructuredWithImage,
    };
    router.get.mockReturnValue(llm);
    const service = makeService();

    const result = await service.processStructuredPromptWithImage(
      PromptTemplate.fromTemplate("grade this image"),
      "data:image/png;base64,AAAA",
      99,
      AIUsageType.ASSIGNMENT_GRADING,
      schema,
      "gpt-4.1-mini",
    );

    expect(result).toEqual({ grade: 4 });
    // The free-form text path must NOT be used when native output exists.
    expect(llm.invokeWithImage).not.toHaveBeenCalled();
    expect(invokeStructuredWithImage).toHaveBeenCalledTimes(1);
    const [textContent, imageData, passedSchema] =
      invokeStructuredWithImage.mock.calls[0];
    expect(textContent).toBe("grade this image");
    expect(imageData).toBe("data:image/png;base64,AAAA");
    expect(passedSchema).toBe(schema);
    expect(usageTracker.trackUsage).toHaveBeenCalledWith(
      99,
      AIUsageType.ASSIGNMENT_GRADING,
      12,
      6,
      "gpt-4.1-mini",
    );
  });

  it("falls back to text parsing for vision providers without native structured output", async () => {
    const llm = {
      key: "granite-vision-3-2-2b",
      invokeWithImage: jest.fn().mockResolvedValue({
        content: '{"grade": 1}',
        tokenUsage: { input: 5, output: 2 },
      }),
    };
    router.get.mockReturnValue(llm);
    const service = makeService();

    const result = await service.processStructuredPromptWithImage(
      PromptTemplate.fromTemplate("grade this image"),
      "data:image/png;base64,AAAA",
      101,
      AIUsageType.ASSIGNMENT_GRADING,
      schema,
      "granite-vision-3-2-2b",
    );

    expect(result).toEqual({ grade: 1 });
    expect(llm.invokeWithImage).toHaveBeenCalledTimes(1);
    expect(usageTracker.trackUsage).toHaveBeenCalledWith(
      101,
      AIUsageType.ASSIGNMENT_GRADING,
      5,
      2,
      "granite-vision-3-2-2b",
    );
  });
});
