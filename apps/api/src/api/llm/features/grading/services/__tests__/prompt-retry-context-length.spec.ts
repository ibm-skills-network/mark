/**
 * The file-grading retry ladder (processPromptWithRetry) must not resend an
 * identical prompt after a context_length_exceeded 400. That error is
 * deterministic for a given prompt, so retrying it on the same model — and then
 * resending it once more on the fallback model — wastes budget and can never
 * succeed. The classifier fail-fast has to break the loop AND skip the fallback
 * resend, propagating the error out immediately.
 *
 * Pre-fix retry counts in this ladder: maxRetries = 3 same-model attempts, then
 * 1 fallback-model attempt -> 4 underlying invokes on a persistent generic
 * error. Post-fix: a context-length error yields exactly 1 invoke and no
 * fallback.
 */
import { PromptTemplate } from "@langchain/core/prompts";

function buildService(processPromptForFeature: jest.Mock) {
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };

  const service = Object.create(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../file-grading.service").FileGradingService.prototype,
  );
  service.logger = mockLogger;
  service.promptProcessor = { processPromptForFeature };
  service.llmResolver = {
    getModelKeyWithFallback: jest.fn().mockResolvedValue("gpt-4o-mini"),
  };
  // Skip the real backoff sleeps so the ladder runs instantly.
  service.delay = jest.fn().mockResolvedValue(undefined);

  return { service, mockLogger };
}

function buildPrompt(): PromptTemplate {
  return new PromptTemplate({ template: "grade this", inputVariables: [] });
}

describe("FileGradingService.processPromptWithRetry context-length fail-fast", () => {
  it("stops after one invoke on a context-length error and never tries the fallback", async () => {
    const contextError = Object.assign(new Error("Request failed"), {
      code: "context_length_exceeded",
    });
    const processPromptForFeature = jest.fn().mockRejectedValue(contextError);
    const { service, mockLogger } = buildService(processPromptForFeature);

    await expect(
      service.processPromptWithRetry(buildPrompt(), 42, "gpt-4o", 10),
    ).rejects.toThrow();

    // Exactly one underlying call: no same-model retries, no fallback resend.
    expect(processPromptForFeature).toHaveBeenCalledTimes(1);
    expect(service.llmResolver.getModelKeyWithFallback).not.toHaveBeenCalled();

    // The fail-fast structured error log fired with the event name.
    expect(mockLogger.error).toHaveBeenCalledWith(
      "file.grading.context.length.exceeded",
      expect.objectContaining({ assignmentId: 42, attempt: 1 }),
    );
  });

  it("uses the full retry ladder (3 same-model + 1 fallback) on a generic error", async () => {
    const processPromptForFeature = jest
      .fn()
      .mockRejectedValue(new Error("Rate limit reached for gpt-4o"));
    const { service, mockLogger } = buildService(processPromptForFeature);

    await expect(
      service.processPromptWithRetry(buildPrompt(), 42, "gpt-4o", 10),
    ).rejects.toThrow();

    // 3 primary-model attempts then 1 fallback-model attempt.
    expect(processPromptForFeature).toHaveBeenCalledTimes(4);
    expect(service.llmResolver.getModelKeyWithFallback).toHaveBeenCalledTimes(
      1,
    );

    // No context-length event log for a non-context-length error.
    expect(mockLogger.error).not.toHaveBeenCalledWith(
      "file.grading.context.length.exceeded",
      expect.anything(),
    );
  });
});
