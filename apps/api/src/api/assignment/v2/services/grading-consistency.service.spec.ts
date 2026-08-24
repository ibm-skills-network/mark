import { QuestionType } from "@prisma/client";
import { Test, type TestingModule } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { PrismaService } from "../../../../database/prisma.service";
import { GradingConsistencyService } from "./grading-consistency.service";

const mockLogger = {
  child: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
};

const findMany = jest.fn();
const mockPrisma = { gradingAudit: { findMany } };

const QUESTION_ID = 4242;

// Same answer text in both the stored audit and the incoming response, so the
// similarity test passes and only the model check can reject reuse.
const ANSWER =
  "Rising thermal averages disrupt the hydrological budget that root vegetables depend upon, so irrigation scheduling shifts toward deficit strategies.";

function auditRow(modelSnapshot?: string) {
  return {
    id: 1,
    requestPayload: JSON.stringify({ learnerTextResponse: ANSWER }),
    responsePayload: JSON.stringify({
      totalPoints: 8,
      maxPoints: 12,
      feedback: "prior feedback",
    }),
    metadata: modelSnapshot ? JSON.stringify({ modelSnapshot }) : null,
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
    return service.checkConsistency(
      QUESTION_ID,
      hash,
      ANSWER,
      QuestionType.TEXT,
      modelIdentity,
    );
  }

  it("reuses a prior grade when the grading model matches", async () => {
    findMany.mockResolvedValue([auditRow("gpt-5.6-luna@rev")]);

    const result = await check("gpt-5.6-luna@rev");

    expect(result.similar).toBe(true);
    expect(result.previousGrade).toBe(8);
  });

  it("refuses to reuse a grade produced by a different model", async () => {
    // The exact regression: staging routed text grading to gpt-5.6-luna while
    // gpt-4o grades from the previous 7 days were still reuse candidates, so
    // learners received gpt-4o grades with no model call at all.
    findMany.mockResolvedValue([auditRow("gpt-4o@rev")]);

    const result = await check("gpt-5.6-luna@rev");

    expect(result.similar).toBe(false);
    expect(result.previousGrade).toBeUndefined();
  });

  it("refuses to reuse a grade recorded before model tracking existed", async () => {
    findMany.mockResolvedValue([auditRow(undefined)]);

    const result = await check("gpt-5.6-luna@rev");

    expect(result.similar).toBe(false);
  });

  it("keeps model-agnostic behaviour when no identity is supplied", async () => {
    findMany.mockResolvedValue([auditRow("gpt-4o@rev")]);

    const result = await check(undefined);

    expect(result.similar).toBe(true);
    expect(result.previousGrade).toBe(8);
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
      8,
      12,
      "prior feedback",
      undefined,
      "gpt-4o@rev",
    );

    await expect(check("gpt-5.6-luna@rev")).resolves.toMatchObject({
      similar: false,
    });
    await expect(check("gpt-4o@rev")).resolves.toMatchObject({
      similar: true,
      previousGrade: 8,
    });
  });
});
