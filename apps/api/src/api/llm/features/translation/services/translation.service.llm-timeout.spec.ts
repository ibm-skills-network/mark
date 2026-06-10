import { AIUsageType } from "@prisma/client";
import { TranslationService } from "./translation.service";

describe("Translation feature LLM call options", () => {
  const makeService = () => {
    const promptProcessor = {
      processPromptForFeature: jest
        .fn()
        .mockResolvedValue('{"translatedText": "Bonjour"}'),
      processPrompt: jest.fn().mockResolvedValue("Bonjour"),
      processPromptWithImage: jest.fn(),
    };
    const logger = {
      child: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    logger.child.mockReturnValue(logger);

    return {
      service: new TranslationService(
        promptProcessor as never,
        logger as never,
      ),
      promptProcessor,
    };
  };

  it("passes a bounded client timeout for question translations", async () => {
    const { service, promptProcessor } = makeService();

    await service.generateQuestionTranslation(7, "Hello", "fr");

    expect(promptProcessor.processPromptForFeature).toHaveBeenCalledWith(
      expect.anything(),
      7,
      AIUsageType.TRANSLATION,
      "translation",
      "gpt-4o-mini",
      expect.objectContaining({
        timeoutMs: expect.any(Number),
        maxRetries: expect.any(Number),
      }),
    );
  });

  it("passes a bounded client timeout for text translations (choices path)", async () => {
    const { service, promptProcessor } = makeService();

    await service.translateText("Hello", "fr", 7);

    expect(promptProcessor.processPromptForFeature).toHaveBeenCalledWith(
      expect.anything(),
      7,
      AIUsageType.TRANSLATION,
      "translation",
      "gpt-4o-mini",
      expect.objectContaining({
        timeoutMs: expect.any(Number),
        maxRetries: expect.any(Number),
      }),
    );
  });
});
