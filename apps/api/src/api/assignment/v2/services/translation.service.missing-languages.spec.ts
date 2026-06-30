import { getAllLanguageCodes } from "../../attempt/helper/languages";
import { TranslationService } from "./translation.service";

describe("TranslationService missing-language retries", () => {
  const originalEnableTranslation = process.env.ENABLE_TRANSLATION;
  const originalRedisUrl = process.env.REDIS_URL;

  beforeEach(() => {
    process.env.ENABLE_TRANSLATION = "true";
    delete process.env.REDIS_URL;
  });

  afterEach(() => {
    if (originalEnableTranslation === undefined) {
      delete process.env.ENABLE_TRANSLATION;
    } else {
      process.env.ENABLE_TRANSLATION = originalEnableTranslation;
    }

    if (originalRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = originalRedisUrl;
    }
  });

  const makeService = (existingLanguageCodes: string[], insertedCount = 1) => {
    const prisma = {
      translation: {
        findMany: jest
          .fn()
          .mockResolvedValue(
            existingLanguageCodes.map((languageCode) => ({ languageCode })),
          ),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $executeRaw: jest.fn().mockResolvedValue(insertedCount),
    };
    const llmFacade = {
      getLanguageCode: jest.fn().mockResolvedValue("en"),
      generateQuestionTranslation: jest
        .fn()
        .mockImplementation(
          async (_assignmentId: number, _text: string, languageCode: string) =>
            `translated:${languageCode}`,
        ),
      generateChoicesTranslation: jest.fn(),
    };
    const jobStatusService = {
      updateJobStatus: jest.fn().mockResolvedValue(undefined),
    };
    const llmResolver = {
      getModelKeyWithFallback: jest.fn().mockResolvedValue("gpt-4o-mini"),
    };

    const service = new TranslationService(
      prisma as never,
      llmFacade as never,
      jobStatusService as never,
      llmResolver as never,
      { isDisabled: () => false } as never,
    );

    return { service, prisma, llmFacade };
  };

  it("translates only missing question languages when forceRetranslation is false", async () => {
    const missingLanguage = "fr";
    const supportedLanguages = getAllLanguageCodes();
    const existingLanguageCodes = supportedLanguages.filter(
      (code) => code !== missingLanguage,
    );
    const { service, prisma, llmFacade } = makeService(existingLanguageCodes);

    try {
      const outcome = await service.translateQuestion(
        7,
        42,
        { question: "Hello", choices: [] } as never,
        undefined,
        false,
      );

      expect(llmFacade.generateQuestionTranslation).toHaveBeenCalledTimes(1);
      expect(llmFacade.generateQuestionTranslation).toHaveBeenCalledWith(
        7,
        "Hello",
        missingLanguage,
      );
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({
        inserted: 1,
        skipped: supportedLanguages.length - 1,
        failed: 0,
      });
    } finally {
      await service.onModuleDestroy();
    }
  });

  it("translates only missing variant languages when forceRetranslation is false", async () => {
    const missingLanguage = "de";
    const supportedLanguages = getAllLanguageCodes();
    const existingLanguageCodes = supportedLanguages.filter(
      (code) => code !== missingLanguage,
    );
    const { service, prisma, llmFacade } = makeService(existingLanguageCodes);

    try {
      const outcome = await service.translateVariant(
        7,
        42,
        99,
        { variantContent: "Hello", choices: [] } as never,
        undefined,
        false,
      );

      expect(llmFacade.generateQuestionTranslation).toHaveBeenCalledTimes(1);
      expect(llmFacade.generateQuestionTranslation).toHaveBeenCalledWith(
        7,
        "Hello",
        missingLanguage,
      );
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({
        inserted: 1,
        skipped: supportedLanguages.length - 1,
        failed: 0,
      });
    } finally {
      await service.onModuleDestroy();
    }
  });
});
