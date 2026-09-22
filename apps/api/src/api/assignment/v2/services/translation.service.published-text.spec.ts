import { TranslationService } from "./translation.service";

/**
 * Publish enqueues TRANSLATE_META before it writes the new version, so a worker
 * that re-read the assignment would resolve the *previous* active version and
 * translate the last publish's text. The job therefore carries the text being
 * published, exactly as TRANSLATE_QUESTION carries its question.
 */
describe("TranslationService assignment-meta published text", () => {
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

  const liveText = {
    id: 7,
    name: "Previous Version Title",
    introduction: "Previous introduction",
    instructions: "Previous instructions",
    gradingCriteriaOverview: "Previous criteria",
  };

  const makeService = () => {
    const prisma = {
      assignmentTranslation: {
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    const llmFacade = {
      translateText: jest
        .fn()
        .mockImplementation(async (text: string) => `translated:${text}`),
    };
    const jobStatusService = {
      updateJobStatus: jest.fn().mockResolvedValue(undefined),
    };
    const llmResolver = {
      getModelKeyWithFallback: jest.fn().mockResolvedValue("gpt-4o-mini"),
    };
    const assignmentRepository = {
      findMetaById: jest.fn().mockResolvedValue({ ...liveText }),
    };

    const service = new TranslationService(
      prisma as never,
      llmFacade as never,
      jobStatusService as never,
      llmResolver as never,
      { isDisabled: () => false } as never,
      assignmentRepository as never,
    );

    return { service, prisma, llmFacade, assignmentRepository };
  };

  const translatedSources = (translateText: jest.Mock): Set<string> =>
    new Set(translateText.mock.calls.map((call) => call[0] as string));

  it("translates the text the publish job supplied, not the stored text", async () => {
    const { service, llmFacade } = makeService();

    try {
      await service.translateAssignment(7, undefined, undefined, false, {
        name: "Published Title",
        introduction: "Published introduction",
        instructions: "Published instructions",
        gradingCriteriaOverview: "Published criteria",
      });

      const sources = translatedSources(llmFacade.translateText as jest.Mock);
      expect(sources.has("Published Title")).toBe(true);
      expect(sources.has("Previous Version Title")).toBe(false);
      expect(sources.has("Published introduction")).toBe(true);
      expect(sources.has("Previous introduction")).toBe(false);
    } finally {
      await service.onModuleDestroy();
    }
  });

  it("falls back to the live text for fields the caller left out", async () => {
    const { service, llmFacade } = makeService();

    try {
      await service.translateAssignment(7, undefined, undefined, false, {
        name: "Published Title",
      });

      const sources = translatedSources(llmFacade.translateText as jest.Mock);
      expect(sources.has("Published Title")).toBe(true);
      // Publishing a title change alone must not blank the rest.
      expect(sources.has("Previous introduction")).toBe(true);
      expect(sources.has("Previous instructions")).toBe(true);
    } finally {
      await service.onModuleDestroy();
    }
  });

  it("translates the live text when no payload text is supplied", async () => {
    const { service, llmFacade } = makeService();

    try {
      await service.translateAssignment(7);

      const sources = translatedSources(llmFacade.translateText as jest.Mock);
      expect(sources.has("Previous Version Title")).toBe(true);
    } finally {
      await service.onModuleDestroy();
    }
  });

  it("still fails when the assignment does not exist", async () => {
    const { service, assignmentRepository } = makeService();
    assignmentRepository.findMetaById.mockResolvedValue(null);

    try {
      await expect(
        service.translateAssignment(7, undefined, undefined, false, {
          name: "Published Title",
        }),
      ).rejects.toThrow(/not found/);
    } finally {
      await service.onModuleDestroy();
    }
  });
});
