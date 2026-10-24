import { TranslationService } from "./translation.service";
import type { LearnerGetAssignmentResponseDto } from "../../dto/get.assignment.response.dto";

/**
 * Every learner assignment load asks applyTranslationsToAssignment for a
 * language. It must not call the LLM: a slow model pushed the load past the
 * web proxy's 30s timeout and learners saw "couldn't load this assignment".
 * English is the authored content; other languages use the stored row.
 */
describe("TranslationService.applyTranslationsToAssignment", () => {
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

  const authored = {
    name: "Original name",
    introduction: "<p>Take and pass this quiz.</p>",
    instructions: "Original instructions",
    gradingCriteriaOverview: "Original criteria",
  };

  const rows: Record<
    string,
    {
      translatedName: string;
      translatedIntroduction: string;
      translatedInstructions: string;
      translatedGradingCriteriaOverview: string;
    }
  > = {
    en: {
      translatedName: "Paraphrased name",
      translatedIntroduction: "<p>Complete and pass this quiz.</p>",
      translatedInstructions: "Paraphrased instructions",
      translatedGradingCriteriaOverview: "Paraphrased criteria",
    },
    ar: {
      translatedName: "اسم",
      translatedIntroduction: "مقدمة",
      translatedInstructions: "تعليمات",
      translatedGradingCriteriaOverview: "معايير",
    },
    "zh-CN": {
      translatedName: "简体名称",
      translatedIntroduction: "简体介绍",
      translatedInstructions: "简体说明",
      translatedGradingCriteriaOverview: "简体标准",
    },
    "zh-TW": {
      translatedName: "繁體名稱",
      translatedIntroduction: "繁體介紹",
      translatedInstructions: "繁體說明",
      translatedGradingCriteriaOverview: "繁體標準",
    },
    pt: {
      translatedName: "Nome",
      translatedIntroduction: "Introdução",
      translatedInstructions: "Instruções",
      translatedGradingCriteriaOverview: "Critérios",
    },
  };

  const makeAssignment = (id: number): LearnerGetAssignmentResponseDto =>
    ({ id, ...authored }) as unknown as LearnerGetAssignmentResponseDto;

  const services: TranslationService[] = [];

  const makeService = () => {
    const prisma = {
      assignmentTranslation: {
        // Mirrors `startsWith` with `mode: "insensitive"`.
        findMany: jest.fn(
          async (arguments_: {
            where: { languageCode: { startsWith: string } };
          }) =>
            Object.entries(rows)
              .filter(([code]) =>
                code
                  .toLowerCase()
                  .startsWith(
                    arguments_.where.languageCode.startsWith.toLowerCase(),
                  ),
              )
              .map(([languageCode, row]) => ({ languageCode, ...row })),
        ),
      },
    };
    const llmFacade = {
      getLanguageCode: jest.fn(() => new Promise<string>(() => {})),
    };
    const service = new TranslationService(
      prisma as never,
      llmFacade as never,
      { updateJobStatus: jest.fn() } as never,
      { isDisabled: () => false } as never,
      {} as never,
    );
    services.push(service);
    return { service, prisma, llmFacade };
  };

  afterEach(async () => {
    await Promise.all(services.splice(0).map((s) => s.onModuleDestroy()));
  });

  it.each(["en", "EN", "en-US", " en-gb "])(
    "serves the authored text for %p without an LLM call, even when an en row exists",
    async (language) => {
      const { service, prisma, llmFacade } = makeService();
      const assignment = makeAssignment(3439);

      await service.applyTranslationsToAssignment(assignment, language);

      expect(llmFacade.getLanguageCode).not.toHaveBeenCalled();
      expect(prisma.assignmentTranslation.findMany).not.toHaveBeenCalled();
      expect(assignment).toMatchObject(authored);
    },
  );

  it("applies the stored row for a non-English language without an LLM call", async () => {
    const { service, prisma, llmFacade } = makeService();
    const assignment = makeAssignment(2934);

    await service.applyTranslationsToAssignment(assignment, "ar");

    expect(llmFacade.getLanguageCode).not.toHaveBeenCalled();
    expect(prisma.assignmentTranslation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assignmentId: 2934,
          languageCode: { startsWith: "ar", mode: "insensitive" },
        },
      }),
    );
    expect(assignment).toMatchObject({
      name: rows.ar.translatedName,
      introduction: rows.ar.translatedIntroduction,
      instructions: rows.ar.translatedInstructions,
      gradingCriteriaOverview: rows.ar.translatedGradingCriteriaOverview,
    });
  });

  it("matches a lower-case region code to the stored row case-insensitively", async () => {
    const { service } = makeService();
    const assignment = makeAssignment(20);

    await service.applyTranslationsToAssignment(assignment, "zh-cn");

    expect(assignment.name).toBe(rows["zh-CN"].translatedName);
    expect(assignment.instructions).toBe(rows["zh-CN"].translatedInstructions);
  });

  it("falls back to the base language when the region has no row", async () => {
    const { service } = makeService();
    const assignment = makeAssignment(21);

    await service.applyTranslationsToAssignment(assignment, "pt-br");

    expect(assignment.name).toBe(rows.pt.translatedName);
  });

  it("falls back to a sibling region when neither exact nor base exists", async () => {
    const { service } = makeService();
    const assignment = makeAssignment(22);

    await service.applyTranslationsToAssignment(assignment, "zh-hk");

    expect(assignment.name).toBe(rows["zh-CN"].translatedName);
  });

  it("keeps the authored text when no row exists for the language", async () => {
    const { service, llmFacade } = makeService();
    const assignment = makeAssignment(12);

    await service.applyTranslationsToAssignment(assignment, "fr");

    expect(llmFacade.getLanguageCode).not.toHaveBeenCalled();
    expect(assignment).toMatchObject(authored);
  });

  it("ignores a repeated lang parameter instead of failing the load", async () => {
    const { service, prisma } = makeService();
    const assignment = makeAssignment(13);

    await service.applyTranslationsToAssignment(assignment, [
      "ar",
      "en",
    ] as unknown as string);

    expect(prisma.assignmentTranslation.findMany).not.toHaveBeenCalled();
    expect(assignment).toMatchObject(authored);
  });
});
