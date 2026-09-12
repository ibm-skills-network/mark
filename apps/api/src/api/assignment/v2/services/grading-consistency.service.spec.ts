import { QuestionType } from "@prisma/client";
import { Test, type TestingModule } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { PrismaService } from "../../../../database/prisma.service";
import {
  deriveLearnerKey,
  GradingConsistencyService,
} from "./grading-consistency.service";

const childLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

const mockLogger = {
  child: jest.fn().mockReturnValue(childLogger),
};

const findMany = jest.fn();
const mockPrisma = { gradingAudit: { findMany } };

const QUESTION_ID = 4242;
const MAX_POINTS = 12;

// Same answer text in both the stored audit and the incoming response, so the
// similarity test passes and only the model check can reject reuse.
const ANSWER =
  "Rising thermal averages disrupt the hydrological budget that root vegetables depend upon, so irrigation scheduling shifts toward deficit strategies.";

const LEARNER_A = deriveLearnerKey("learner-a@example.com");
const LEARNER_B = deriveLearnerKey("learner-b@example.com");

interface AuditRowOptions {
  modelSnapshot?: string;
  learnerKey?: string;
  response?: string;
  totalPoints?: number;
  maxPoints?: number;
}

function auditRow(options: AuditRowOptions = {}) {
  const metadata: Record<string, string> = {};
  if (options.modelSnapshot) metadata.modelSnapshot = options.modelSnapshot;
  if (options.learnerKey) metadata.learnerKey = options.learnerKey;

  return {
    id: 1,
    requestPayload: JSON.stringify({
      learnerTextResponse: options.response ?? ANSWER,
    }),
    responsePayload: JSON.stringify({
      totalPoints: options.totalPoints ?? MAX_POINTS,
      maxPoints: options.maxPoints ?? MAX_POINTS,
      feedback: "prior feedback",
    }),
    metadata:
      Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
    timestamp: new Date(),
  };
}

describe("GradingConsistencyService model-scoped reuse", () => {
  let service: GradingConsistencyService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GradingConsistencyService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: WINSTON_MODULE_PROVIDER, useValue: mockLogger },
      ],
    }).compile();

    service = module.get(GradingConsistencyService);
  });

  afterEach(() => {
    service.onModuleDestroy?.();
  });

  async function check(modelIdentity?: string) {
    const hash = service.generateResponseHash(
      ANSWER,
      QUESTION_ID,
      QuestionType.TEXT,
    );
    return service.checkConsistency(QUESTION_ID, hash, ANSWER, {
      questionType: QuestionType.TEXT,
      modelIdentity,
      maxPoints: MAX_POINTS,
      learnerKey: LEARNER_A,
      attemptId: 987,
    });
  }

  it("reuses a prior grade when the grading model matches", async () => {
    findMany.mockResolvedValue([
      auditRow({ modelSnapshot: "gpt-5.6-luna@rev" }),
    ]);

    const result = await check("gpt-5.6-luna@rev");

    expect(result.similar).toBe(true);
    expect(result.previousGrade).toBe(MAX_POINTS);
  });

  it("refuses to reuse a grade produced by a different model", async () => {
    // The exact regression: staging routed text grading to gpt-5.6-luna while
    // gpt-4o grades from the previous 7 days were still reuse candidates, so
    // learners received gpt-4o grades with no model call at all.
    findMany.mockResolvedValue([auditRow({ modelSnapshot: "gpt-4o@rev" })]);

    const result = await check("gpt-5.6-luna@rev");

    expect(result.similar).toBe(false);
    expect(result.previousGrade).toBeUndefined();
  });

  it("refuses to reuse a grade recorded before model tracking existed", async () => {
    findMany.mockResolvedValue([auditRow()]);

    const result = await check("gpt-5.6-luna@rev");

    expect(result.similar).toBe(false);
  });

  it("keeps model-agnostic behaviour when no identity is supplied", async () => {
    findMany.mockResolvedValue([auditRow({ modelSnapshot: "gpt-4o@rev" })]);

    const result = await check(undefined);

    expect(result.similar).toBe(true);
    expect(result.previousGrade).toBe(MAX_POINTS);
  });

  it("does not serve an in-memory record across grading models", async () => {
    findMany.mockResolvedValue([]);

    const hash = service.generateResponseHash(
      ANSWER,
      QUESTION_ID,
      QuestionType.TEXT,
    );
    await service.recordGrading(
      QUESTION_ID,
      hash,
      MAX_POINTS,
      MAX_POINTS,
      "prior feedback",
      undefined,
      "gpt-4o@rev",
    );

    await expect(check("gpt-5.6-luna@rev")).resolves.toMatchObject({
      similar: false,
    });
    await expect(check("gpt-4o@rev")).resolves.toMatchObject({
      similar: true,
      previousGrade: MAX_POINTS,
    });
  });
});

describe("GradingConsistencyService reuse safety", () => {
  let service: GradingConsistencyService;

  // A one-token difference decides correctness on short code answers: this is
  // the shape that replayed one learner's zero onto another learner's correct
  // statement.
  const WRONG_SQL = "CREATE INDEX idx_billed ON billdata(billingamount);";
  const CORRECT_SQL = "CREATE INDEX idx_billed ON billdata(billedamount);";

  // Long answers fall on the word-set comparison path. Same vocabulary, one
  // rearranged into a correct explanation and one into a weak one.
  const LONG_WEAK = `${"caching stores a computed value so the application does not recompute it for every request and the stored value can go stale when the underlying data changes which is why an entry needs invalidation ".repeat(3)}`;
  const LONG_STRONG = `${"invalidation of an entry matters because the stored value can go stale when the underlying data changes so caching a computed value which the application does not recompute for every request needs it ".repeat(3)}`;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GradingConsistencyService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: WINSTON_MODULE_PROVIDER, useValue: mockLogger },
      ],
    }).compile();

    service = module.get(GradingConsistencyService);
  });

  afterEach(() => {
    service.onModuleDestroy?.();
  });

  function lookupFor(
    response: string,
    overrides: Partial<{
      maxPoints: number;
      learnerKey: string;
      attemptId: number;
    }> = {},
  ) {
    return {
      hash: service.generateResponseHash(
        response,
        QUESTION_ID,
        QuestionType.TEXT,
      ),
      lookup: {
        questionType: QuestionType.TEXT,
        maxPoints: overrides.maxPoints ?? 1,
        learnerKey: overrides.learnerKey ?? LEARNER_A,
        attemptId: overrides.attemptId ?? 555,
      },
    };
  }

  async function checkFor(
    response: string,
    overrides?: Parameters<typeof lookupFor>[1],
  ) {
    const { hash, lookup } = lookupFor(response, overrides);
    return service.checkConsistency(QUESTION_ID, hash, response, lookup);
  }

  describe("a grade below full marks is never reused", () => {
    it("refuses a byte-identical answer whose prior grade was not full marks", async () => {
      findMany.mockResolvedValue([
        auditRow({
          response: CORRECT_SQL,
          learnerKey: LEARNER_A,
          totalPoints: 0,
          maxPoints: 1,
        }),
      ]);

      await expect(checkFor(CORRECT_SQL)).resolves.toMatchObject({
        similar: false,
      });
    });

    it("refuses the learner's own near-identical resubmission of a sub-full grade", async () => {
      findMany.mockResolvedValue([
        auditRow({
          response: WRONG_SQL,
          learnerKey: LEARNER_A,
          totalPoints: 0,
          maxPoints: 1,
        }),
      ]);

      await expect(checkFor(CORRECT_SQL)).resolves.toMatchObject({
        similar: false,
      });
    });

    it("refuses a sub-full in-memory record for the identical answer", async () => {
      findMany.mockResolvedValue([]);
      const { hash, lookup } = lookupFor(CORRECT_SQL);
      await service.recordGrading(QUESTION_ID, hash, 0, 1, "prior feedback");

      await expect(
        service.checkConsistency(QUESTION_ID, hash, CORRECT_SQL, lookup),
      ).resolves.toMatchObject({ similar: false });
    });

    it("still reuses a full-marks grade for the identical answer", async () => {
      findMany.mockResolvedValue([
        auditRow({
          response: CORRECT_SQL,
          learnerKey: LEARNER_B,
          totalPoints: 1,
          maxPoints: 1,
        }),
      ]);

      await expect(checkFor(CORRECT_SQL)).resolves.toMatchObject({
        similar: true,
        previousGrade: 1,
      });
    });

    it("refuses reuse when the question's full marks are unknown", async () => {
      findMany.mockResolvedValue([
        auditRow({
          response: CORRECT_SQL,
          learnerKey: LEARNER_A,
          totalPoints: 1,
          maxPoints: 1,
        }),
      ]);

      const hash = service.generateResponseHash(
        CORRECT_SQL,
        QUESTION_ID,
        QuestionType.TEXT,
      );

      await expect(
        service.checkConsistency(QUESTION_ID, hash, CORRECT_SQL, {
          questionType: QuestionType.TEXT,
          learnerKey: LEARNER_A,
        }),
      ).resolves.toMatchObject({ similar: false });
    });
  });

  describe("another learner's grade is reusable only on an exact match", () => {
    it("refuses a near-miss match against another learner's full-marks grade", async () => {
      findMany.mockResolvedValue([
        auditRow({
          response: WRONG_SQL,
          learnerKey: LEARNER_B,
          totalPoints: 1,
          maxPoints: 1,
        }),
      ]);

      await expect(checkFor(CORRECT_SQL)).resolves.toMatchObject({
        similar: false,
      });
    });

    it("refuses a long rewrite that shares another learner's vocabulary", async () => {
      findMany.mockResolvedValue([
        auditRow({
          response: LONG_WEAK,
          learnerKey: LEARNER_B,
          totalPoints: 4,
          maxPoints: 4,
        }),
      ]);

      await expect(
        checkFor(LONG_STRONG, { maxPoints: 4 }),
      ).resolves.toMatchObject({ similar: false });
    });

    it("refuses a near-miss match when the prior grade has no learner recorded", async () => {
      findMany.mockResolvedValue([
        auditRow({ response: WRONG_SQL, totalPoints: 1, maxPoints: 1 }),
      ]);

      await expect(checkFor(CORRECT_SQL)).resolves.toMatchObject({
        similar: false,
      });
    });

    it("accepts an exact normalized match from another learner at full marks", async () => {
      findMany.mockResolvedValue([
        auditRow({
          response: `  ${CORRECT_SQL.toUpperCase()}  `,
          learnerKey: LEARNER_B,
          totalPoints: 1,
          maxPoints: 1,
        }),
      ]);

      await expect(checkFor(CORRECT_SQL)).resolves.toMatchObject({
        similar: true,
        previousGrade: 1,
      });
    });

    it("accepts the learner's own near-identical answer at full marks", async () => {
      findMany.mockResolvedValue([
        auditRow({
          response: WRONG_SQL,
          learnerKey: LEARNER_A,
          totalPoints: 1,
          maxPoints: 1,
        }),
      ]);

      await expect(checkFor(CORRECT_SQL)).resolves.toMatchObject({
        similar: true,
        previousGrade: 1,
      });
    });
  });

  describe("the reuse decision is observable", () => {
    it("logs one structured line when a grade is reused", async () => {
      findMany.mockResolvedValue([
        auditRow({
          response: CORRECT_SQL,
          learnerKey: LEARNER_B,
          totalPoints: 1,
          maxPoints: 1,
        }),
      ]);

      await checkFor(CORRECT_SQL, { attemptId: 424_242 });

      expect(childLogger.info).toHaveBeenCalledTimes(1);
      expect(childLogger.info).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          questionId: QUESTION_ID,
          attemptId: 424_242,
          reason: expect.any(String),
        }),
      );
    });

    it("logs a debug line for a rejected candidate", async () => {
      findMany.mockResolvedValue([
        auditRow({
          response: WRONG_SQL,
          learnerKey: LEARNER_B,
          totalPoints: 0,
          maxPoints: 1,
        }),
      ]);

      await checkFor(CORRECT_SQL, { attemptId: 424_243 });

      expect(childLogger.info).not.toHaveBeenCalled();
      expect(childLogger.debug).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          questionId: QUESTION_ID,
          attemptId: 424_243,
          reason: expect.any(String),
        }),
      );
    });
  });

  describe("grading statistics are unaffected", () => {
    it("still summarises recent gradings for a question", async () => {
      findMany.mockResolvedValue([
        auditRow({ totalPoints: 1, maxPoints: 1 }),
        auditRow({ totalPoints: 0, maxPoints: 1 }),
      ]);

      const stats = await service.getGradingStatistics(QUESTION_ID);

      expect(stats.totalGradings).toBe(2);
      expect(stats.averageScore).toBe(50);
      expect(stats.distribution).toMatchObject({ "0-9%": 1, "100-109%": 1 });
    });
  });
});
