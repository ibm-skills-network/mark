import { PromptTemplate } from "@langchain/core/prompts";
import { AIUsageType } from "@prisma/client";
import { z } from "zod";
import { LlmQuotaExceededError } from "../utils/llm-error.util";
import { PromptProcessorService } from "./prompt-processor.service";

describe("PromptProcessorService", () => {
  const logger = {
    error: jest.fn(),
  };
  const parentLogger = {
    child: jest.fn(),
  };
  const usageTracker = {
    trackUsage: jest.fn(),
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
});

describe("PromptProcessorService.processStructuredPromptForFeature", () => {
  const logger = { error: jest.fn(), warn: jest.fn() };
  const parentLogger = { child: jest.fn() };
  const usageTracker = { trackUsage: jest.fn() };
  const router = {
    get: jest.fn(),
    getForFeatureWithFallback: jest.fn(),
  };

  const schema = z.object({ grade: z.number() });

  const makeService = () =>
    new PromptProcessorService(
      router as any,
      usageTracker as any,
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
      tokenUsage: { input: 10, output: 5 },
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
});

describe("PromptProcessorService resilience", () => {
  const logger = { error: jest.fn(), warn: jest.fn() };
  const parentLogger = { child: jest.fn() };
  const usageTracker = { trackUsage: jest.fn() };
  const llm = { key: "gpt-4o-mini", invoke: jest.fn() };
  const router = { get: jest.fn(), getForFeatureWithFallback: jest.fn() };

  const makeService = () =>
    new PromptProcessorService(
      router as any,
      usageTracker as any,
      parentLogger as any,
    );

  const call = (service: PromptProcessorService) =>
    service.processPrompt(
      "do it",
      1,
      AIUsageType.ASSIGNMENT_GRADING,
      "gpt-4o-mini",
    );

  beforeEach(() => {
    jest.clearAllMocks();
    parentLogger.child.mockReturnValue(logger);
    router.get.mockReturnValue(llm);
    usageTracker.trackUsage.mockResolvedValue(undefined);
    // Make backoff instant so the retry tests don't actually sleep.
    jest.spyOn(global, "setTimeout").mockImplementation(((cb: () => void) => {
      cb();
      return 0 as unknown as NodeJS.Timeout;
    }) as unknown as typeof setTimeout);
  });

  afterEach(() => {
    (global.setTimeout as unknown as jest.SpyInstance).mockRestore?.();
  });

  it("retries a transient failure then succeeds", async () => {
    llm.invoke
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValue({
        content: "ok",
        tokenUsage: { input: 1, output: 1 },
      });

    const service = makeService();
    await expect(call(service)).resolves.toBe("ok");

    expect(llm.invoke).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      "llm.retry",
      expect.objectContaining({ kind: "transient", attempt: 1 }),
    );
  });

  it("gives up after exhausting retries on a persistent transient failure", async () => {
    llm.invoke.mockRejectedValue(
      Object.assign(new Error("Service Unavailable"), { status: 503 }),
    );

    const service = makeService();
    await expect(call(service)).rejects.toThrow("Service Unavailable");

    // initial attempt + MAX_LLM_RETRIES (2) = 3 invocations.
    expect(llm.invoke).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry an insufficient_quota error and surfaces a quota error", async () => {
    llm.invoke.mockRejectedValue(
      Object.assign(
        new Error(
          "429 You exceeded your current quota, please check your plan and billing details.",
        ),
        { status: 429 },
      ),
    );

    const service = makeService();
    await expect(call(service)).rejects.toBeInstanceOf(LlmQuotaExceededError);

    // Quota is non-retryable: exactly one provider call.
    expect(llm.invoke).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      "llm.quota_exceeded",
      expect.objectContaining({ model: "gpt-4o-mini" }),
    );
  });

  it("opens the circuit so subsequent calls fail fast without hitting the provider", async () => {
    llm.invoke.mockRejectedValue(
      Object.assign(new Error("You exceeded your current quota"), {
        status: 429,
      }),
    );

    const service = makeService();
    await expect(call(service)).rejects.toBeInstanceOf(LlmQuotaExceededError);
    expect(llm.invoke).toHaveBeenCalledTimes(1);

    // Circuit is now open — the next call must not reach the provider.
    await expect(call(service)).rejects.toBeInstanceOf(LlmQuotaExceededError);
    expect(llm.invoke).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "llm.quota.circuit_open",
      expect.objectContaining({ model: "gpt-4o-mini" }),
    );
  });

  it("carries a retryAfterSeconds hint on the quota error", async () => {
    llm.invoke.mockRejectedValue(
      Object.assign(new Error("insufficient_quota"), {
        status: 429,
        code: "insufficient_quota",
      }),
    );

    const service = makeService();
    await call(service).catch((error: unknown) => {
      expect(error).toBeInstanceOf(LlmQuotaExceededError);
      expect(
        (error as LlmQuotaExceededError).retryAfterSeconds,
      ).toBeGreaterThanOrEqual(60);
    });
  });
});
