import { QuestionResponseService } from "../question-response/question-response.service";
import { newJobScopedCache } from "./job-scoped-cache";

// Fixture sized to expose the original Instana N+1 pattern at scale:
// 10 questions x 2 distinct languages -> 20 questions worth of translation lookups.
const fixtureQuestionIds = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110];
const fixtureLanguages = ["es", "fr"];

const buildFullQuestionRows = () =>
  fixtureQuestionIds.map((id) => ({
    id,
    totalPoints: 1,
    type: "TEXT",
    responseType: "TEXT",
    authorComment: null,
    question: `Question ${id}`,
    maxWords: null,
    scoring: null,
    choices: null,
    randomizedChoices: null,
    answer: null,
    assignmentId: 1,
    gradingContextQuestionIds: [],
    maxCharacters: null,
    isDeleted: false,
    videoPresentationConfig: null,
    liveRecordingConfig: null,
  }));

const buildMockPrisma = () => {
  const findManyResult = buildFullQuestionRows();
  const mock: any = {
    assignment: {
      findUnique: jest.fn().mockResolvedValue({ id: 1, instructions: "" }),
    },
    question: {
      findUnique: jest
        .fn()
        .mockImplementation(({ where: { id } }: any) =>
          Promise.resolve(findManyResult.find((q) => q.id === id) ?? null),
        ),
      findMany: jest.fn().mockResolvedValue(findManyResult),
    },
    translation: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    assignmentAttempt: {
      findUnique: jest.fn().mockResolvedValue({
        id: 1,
        assignmentId: 1,
        userId: "noahfreelove@example.test",
        submitted: false,
        grade: null,
        preferredLanguage: null,
        questionVariants: [],
      }),
    },
    questionResponse: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      createMany: jest.fn(),
      upsert: jest.fn(),
    },
    // $transaction: pass through with `tx = mock` (same surface)
    $transaction: jest.fn(async (fnOrOps: any) => {
      if (typeof fnOrOps === "function") return fnOrOps(mock);
      return Promise.all(fnOrOps);
    }),
  };
  return mock;
};

/**
 * Build a QuestionResponseService instance with concrete ctor mocks.
 * The ctor signature has EXACTLY 6 parameters:
 *   1. prisma: PrismaService                  - the mockPrisma above
 *   2. questionService: QuestionService       - .findOne called from getLearnerQuestion
 *   3. localizationService: LocalizationService - non-exercised in the cache path; cast
 *   4. gradingFactoryService: GradingFactoryService - .getStrategy called per question
 *   5. parentLogger: Logger (winston)         - .child() called in ctor body
 *   6. progressService?: GradingProgressService - optional; undefined
 */
const buildService = (mockPrisma: any) => {
  const seededDto = {
    ...buildFullQuestionRows()[0],
    alreadyInBackend: true,
    success: true,
  };

  const questionService = {
    findOne: jest.fn().mockResolvedValue(seededDto),
  } as any;

  // Strategy that resolves the validate -> extract -> grade chain so each question completes.
  const noopStrategy = {
    validateResponse: jest.fn().mockResolvedValue(true),
    extractLearnerResponse: jest.fn().mockResolvedValue(""),
    gradeResponse: jest.fn().mockResolvedValue({
      totalPoints: 0,
      feedback: [],
      metadata: null,
    }),
  };

  const gradingFactoryService = {
    getStrategy: jest.fn().mockReturnValue(noopStrategy),
  } as any;

  // winston-style logger: parentLogger.child({...}) returns a child logger with the same surface.
  const childLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };
  const parentLogger = {
    child: jest.fn().mockReturnValue(childLogger),
  } as any;

  // localizationService is only called inside handleEmptyResponse; the fixture's responses are non-empty.
  const localizationService = {} as any;

  // progressService is optional; pass undefined.
  const progressService = undefined;

  // rateLimiter passes scheduled operations through synchronously. parallelEnabled=true
  // so the wave scheduler emits per-question states (matching production default).
  const rateLimiter = {
    parallelEnabled: true,
    concurrency: 10,
    schedule: async <T>(_name: string, op: () => Promise<T>) => op(),
  } as any;

  return new QuestionResponseService(
    mockPrisma,
    questionService,
    localizationService,
    gradingFactoryService,
    rateLimiter,
    parentLogger,
    progressService,
  );
};

describe("Grading per-job query-count regression", () => {
  let mockPrisma: ReturnType<typeof buildMockPrisma>;
  let service: QuestionResponseService;

  beforeEach(() => {
    mockPrisma = buildMockPrisma();
    service = buildService(mockPrisma);
  });

  it("issues 1 Question.findMany hoist + 0 per-row Question.findUnique calls in the grading loop", async () => {
    const cache = newJobScopedCache();
    // Minimal DTO subset - gradeQuestionsForLearner only reads `id` for the Phase 0 hoist
    // and the strategy mocks consume `learnerResponse`/`language` indirectly. The
    // `noopStrategy.extractLearnerResponse` returns "" regardless of input, so the rest of
    // the DTO surface is never accessed. `learnerTextResponse: "answer"` keeps
    // `isEmptyResponse` returning false so the strategy chain runs (vs short-circuit through
    // `handleEmptyResponse`, which would call `localizationService` - intentionally an empty
    // cast). The `as any[]` cast is documented inline.
    const responsesForQuestions = fixtureQuestionIds.map((id) => ({
      id,
      learnerTextResponse: "answer",
      language: "en",
    })) as any[];

    await service.gradeQuestionsForLearner(
      responsesForQuestions,
      1, // assignmentAttemptId
      1, // assignmentId
      "en", // language
      undefined, // preTranslatedQuestions
      cache,
    );

    expect(
      mockPrisma.question.findMany.mock.calls.length,
    ).toBeGreaterThanOrEqual(1);
    // Per-row N+1 inside the grading loop is gone. With the cache pre-populated
    // by the Phase 0 hoist, NO findUnique should fire for this fixture.
    expect(mockPrisma.question.findUnique.mock.calls.length).toBe(0);
  });

  it("hoists unconditionally even when caller omits the cache argument", async () => {
    const responsesForQuestions = fixtureQuestionIds.map((id) => ({
      id,
      learnerTextResponse: "answer",
      language: "en",
    })) as any[];

    await service.gradeQuestionsForLearner(
      responsesForQuestions,
      1,
      1,
      "en",
      undefined,
      undefined, // no cache passed
    );

    // Phase 0 hoist must run regardless of cache arg, so the per-row N+1 is
    // gone even on the legacy uncached path.
    expect(
      mockPrisma.question.findMany.mock.calls.length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      mockPrisma.question.findUnique.mock.calls.length,
    ).toBeLessThanOrEqual(1);
    expect(
      mockPrisma.assignment.findUnique.mock.calls.length,
    ).toBeLessThanOrEqual(2);
  });

  it("issues at most 2 Assignment.findUnique calls per grading job", async () => {
    const cache = newJobScopedCache();
    const responsesForQuestions = fixtureQuestionIds.map((id) => ({
      id,
      learnerTextResponse: "answer",
      language: "en",
    })) as any[];

    await service.gradeQuestionsForLearner(
      responsesForQuestions,
      1,
      1,
      "en",
      undefined,
      cache,
    );

    expect(
      mockPrisma.assignment.findUnique.mock.calls.length,
    ).toBeLessThanOrEqual(2);
  });

  it("issues Translation.findFirst calls at most once per (language, questionId, variantId) tuple", async () => {
    const cache = newJobScopedCache();
    // Drive the spec across BOTH languages by running gradeQuestionsForLearner once per language
    // with the same cache (cache lifetime spans the whole job).
    for (const lang of fixtureLanguages) {
      const responsesForQuestions = fixtureQuestionIds.map((id) => ({
        id,
        learnerTextResponse: "answer",
        language: lang,
      })) as any[];

      await service.gradeQuestionsForLearner(
        responsesForQuestions,
        1,
        1,
        lang,
        undefined,
        cache,
      );
    }

    const calls = mockPrisma.translation.findFirst.mock.calls;
    const tuples = new Set(
      calls.map((args: any[]) => {
        const where = args[0]?.where ?? {};
        return `${where.languageCode ?? ""}:${where.questionId ?? ""}:${where.variantId ?? "null"}`;
      }),
    );
    // distinct tuples should match the call count (no repeats)
    expect(calls.length).toBe(tuples.size);
    // upper bound: 2 languages x 10 questions x 3-step fallback chain = 60. Cache must keep us well under.
    expect(calls.length).toBeLessThanOrEqual(2 * fixtureQuestionIds.length * 3);
  });
});
