import { AIUsageType } from "@prisma/client";
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
