import { getAllLanguageCodes } from "../../attempt/helper/languages";
import { TranslationService } from "./translation.service";

type FakeStateRedis = {
  hset: jest.Mock;
  hsetnx: jest.Mock;
  expire: jest.Mock;
  eval: jest.Mock;
  quit: jest.Mock;
};

type ServiceInternals = {
  translationStateRedis: FakeStateRedis;
  RETRY_DELAY_BASE: number;
  OPERATION_TIMEOUT: number;
  MAX_RETRY_ATTEMPTS: number;
  limiter: {
    schedule: (
      options: { expiration?: number },
      fn: () => Promise<unknown>,
    ) => Promise<unknown>;
  };
};

describe("TranslationService partial-failure status and scheduling budget", () => {
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

  const makeService = (existingLanguageCodes: string[]) => {
    const prisma = {
      translation: {
        findMany: jest
          .fn()
          .mockResolvedValue(
            existingLanguageCodes.map((languageCode) => ({ languageCode })),
          ),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $executeRaw: jest.fn().mockResolvedValue(0),
    };
    const llmFacade = {
      getLanguageCode: jest.fn().mockResolvedValue("en"),
      generateQuestionTranslation: jest.fn(),
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

    const fakeRedis: FakeStateRedis = {
      hset: jest.fn().mockResolvedValue(1),
      hsetnx: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      eval: jest.fn().mockResolvedValue(0),
      quit: jest.fn().mockResolvedValue("OK"),
    };
    const internals = service as unknown as ServiceInternals;
    Object.defineProperty(internals, "translationStateRedis", {
      value: fakeRedis,
    });
    // Keep retry backoff out of the test runtime; the retry COUNT is
    // what matters here, not the production pacing.
    Object.defineProperty(internals, "RETRY_DELAY_BASE", { value: 1 });

    return { service, internals, prisma, llmFacade, fakeRedis };
  };

  const terminalEntryFor = (fakeRedis: FakeStateRedis, field: string) => {
    const writes = fakeRedis.hset.mock.calls.filter(
      ([, writtenField]) => writtenField === field,
    );
    expect(writes.length).toBeGreaterThan(0);
    const [, , json] = writes.at(-1) as [string, string, string];
    return JSON.parse(json) as { status: string };
  };

  it("leaves the publish entry in_progress when languages fail and the job will be retried", async () => {
    const supportedLanguages = getAllLanguageCodes();
    const existing = supportedLanguages.filter((code) => code !== "fr");
    const { service, llmFacade, fakeRedis } = makeService(existing);
    llmFacade.generateQuestionTranslation.mockRejectedValue(
      new Error("llm unavailable"),
    );

    try {
      const outcome = await service.translateQuestion(
        7,
        42,
        { question: "Hello", choices: [] } as never,
        "publish:v2:7",
        false,
        false,
      );

      expect(outcome.failed).toBe(1);
      expect(terminalEntryFor(fakeRedis, "question:42").status).toBe(
        "in_progress",
      );
    } finally {
      await service.onModuleDestroy();
    }
  });

  it("marks the publish entry failed when languages fail on the final attempt", async () => {
    const supportedLanguages = getAllLanguageCodes();
    const existing = supportedLanguages.filter((code) => code !== "fr");
    const { service, llmFacade, fakeRedis } = makeService(existing);
    llmFacade.generateQuestionTranslation.mockRejectedValue(
      new Error("llm unavailable"),
    );

    try {
      const outcome = await service.translateQuestion(
        7,
        42,
        { question: "Hello", choices: [] } as never,
        "publish:v2:7",
        false,
        true,
      );

      expect(outcome.failed).toBe(1);
      expect(terminalEntryFor(fakeRedis, "question:42").status).toBe("failed");
    } finally {
      await service.onModuleDestroy();
    }
  });

  it("gives each fan-out operation a limiter expiration covering the full retry budget", async () => {
    const supportedLanguages = getAllLanguageCodes();
    const existing = supportedLanguages.filter((code) => code !== "fr");
    const { service, internals, llmFacade } = makeService(existing);
    llmFacade.generateQuestionTranslation.mockResolvedValue("translated:fr");
    const scheduleSpy = jest.spyOn(internals.limiter, "schedule");

    try {
      await service.translateQuestion(
        7,
        42,
        { question: "Hello", choices: [] } as never,
        undefined,
        false,
      );

      expect(scheduleSpy).toHaveBeenCalled();
      const [options] = scheduleSpy.mock.calls[0];
      // The scheduled operation wraps the whole per-language retry loop
      // (MAX_RETRY_ATTEMPTS attempts of OPERATION_TIMEOUT each, plus
      // backoff pauses). An expiration shorter than that budget kills the
      // operation on the first slow attempt and the retries never run —
      // the exact failure observed in production publishes.
      const retryBudget =
        internals.OPERATION_TIMEOUT * internals.MAX_RETRY_ATTEMPTS +
        internals.RETRY_DELAY_BASE * 2 * (internals.MAX_RETRY_ATTEMPTS - 1);
      expect(options.expiration).toBeGreaterThanOrEqual(retryBudget);
    } finally {
      await service.onModuleDestroy();
    }
  });
});
