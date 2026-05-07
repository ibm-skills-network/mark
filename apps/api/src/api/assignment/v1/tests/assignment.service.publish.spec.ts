/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from "@nestjs/testing";
import { QuestionType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { JobStatusServiceV1 } from "src/api/Job/job-status.service";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import { PrismaService } from "src/database/prisma.service";
import { JobQueueService } from "src/job-queue/job-queue.service";

import { UpdateAssignmentQuestionsDto } from "../../dto/update.questions.request.dto";
import { AssignmentServiceV1 } from "../services/assignment.service";

describe("AssignmentServiceV1 - runPublishJob - Processing questions", () => {
  // NODE_ENV=development inside the constructor disables language translation
  // so the supportedLanguages loop runs for English only.
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  beforeAll(() => {
    process.env.NODE_ENV = "development";
  });
  afterAll(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  type CallRecord = { method: string; args: any };

  let service: AssignmentServiceV1;
  let prismaCalls: CallRecord[];
  let prismaMock: any;
  let logger: any;

  const buildPayload = (
    overrides: Partial<UpdateAssignmentQuestionsDto> = {},
  ): UpdateAssignmentQuestionsDto =>
    ({
      introduction: "intro",
      instructions: "instr",
      gradingCriteriaOverview: "criteria",
      numAttempts: -1,
      attemptsBeforeCoolDown: 1,
      retakeAttemptCoolDownMinutes: 5,
      passingGrade: 60,
      displayOrder: "RANDOM",
      graded: true,
      questionDisplay: "ONE_PER_PAGE",
      allotedTimeMinutes: null,
      timeEstimateMinutes: null,
      updatedAt: new Date(),
      published: true,
      questions: [],
      showAssignmentScore: true,
      showQuestionScore: true,
      showSubmissionFeedback: true,
      showQuestions: true,
      ...overrides,
    }) as unknown as UpdateAssignmentQuestionsDto;

  const setupPrismaMock = (existingByAssignment: Map<number, any[]>) => {
    prismaCalls = [];
    const recordingFn = (method: string) =>
      jest.fn(async (args: any) => {
        prismaCalls.push({ method, args });
        if (method === "question.findMany") {
          const list =
            existingByAssignment.get(args?.where?.assignmentId) ?? [];
          return list;
        }
        if (method === "question.create") {
          return { id: 9000 + prismaCalls.length, ...(args?.data ?? {}) };
        }
        if (method === "question.updateMany") {
          // Return matched count: 1 if a row exists with that id under that assignment.
          const id = args?.where?.id;
          const assignmentId = args?.where?.assignmentId;
          const list = existingByAssignment.get(assignmentId) ?? [];
          const match = list.find((r) => r.id === id);
          return { count: match ? 1 : 0 };
        }
        if (method === "question.upsert") {
          // Should not be called by the GREEN code; if it is, the test will catch it.
          return { id: args?.where?.id ?? 0 };
        }
        if (method === "questionVariant.updateMany") {
          return { count: 0 };
        }
        if (method === "questionVariant.create") {
          return {};
        }
        if (method === "assignment.update") {
          return { id: args?.where?.id };
        }
        if (method === "assignment.findUnique") {
          return { id: args?.where?.id, questions: [], questionOrder: [] };
        }
        if (method === "assignmentAuthor.findFirst") {
          return null;
        }
        if (method === "assignmentAuthor.create") {
          return {};
        }
        return undefined;
      });

    prismaMock = {
      question: {
        findMany: recordingFn("question.findMany"),
        create: recordingFn("question.create"),
        updateMany: recordingFn("question.updateMany"),
        upsert: recordingFn("question.upsert"),
      },
      questionVariant: {
        updateMany: recordingFn("questionVariant.updateMany"),
        create: recordingFn("questionVariant.create"),
      },
      assignment: {
        update: recordingFn("assignment.update"),
        findUnique: recordingFn("assignment.findUnique"),
      },
      assignmentAuthor: {
        findFirst: recordingFn("assignmentAuthor.findFirst"),
        create: recordingFn("assignmentAuthor.create"),
      },
    };
    return prismaMock;
  };

  const buildModule = async (existingByAssignment: Map<number, any[]>) => {
    const prisma = setupPrismaMock(existingByAssignment);

    logger = {
      child: jest.fn().mockReturnThis(),
      info: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    const llmFacadeService = {
      getLanguageCode: jest.fn().mockResolvedValue("en"),
      applyGuardRails: jest.fn().mockResolvedValue(true),
      generateQuestionGradingContext: jest.fn().mockResolvedValue(new Map()),
    };

    const jobStatusService = {
      getJobStatus: jest.fn().mockResolvedValue({ id: "job-1" }),
      updateJobStatus: jest.fn().mockResolvedValue(undefined),
      createPublishJob: jest.fn().mockResolvedValue({ id: "job-1" }),
      createJob: jest.fn().mockResolvedValue({ id: "job-1" }),
    };

    const jobQueueService = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssignmentServiceV1,
        { provide: PrismaService, useValue: prisma },
        { provide: LlmFacadeService, useValue: llmFacadeService },
        { provide: JobStatusServiceV1, useValue: jobStatusService },
        { provide: JobQueueService, useValue: jobQueueService },
        { provide: WINSTON_MODULE_PROVIDER, useValue: logger },
      ],
    }).compile();

    service = module.get<AssignmentServiceV1>(AssignmentServiceV1);

    // Stub the translation helpers so the test focuses on the question-write path.
    (service as any).handleQuestionTranslations = jest
      .fn()
      .mockResolvedValue(undefined);
    (service as any).handleVariantTranslations = jest
      .fn()
      .mockResolvedValue(undefined);
    (service as any).handleAssignmentTranslations = jest
      .fn()
      .mockResolvedValue(undefined);
    (service as any).handleQuestionGradingContext = jest
      .fn()
      .mockResolvedValue(undefined);

    return service;
  };

  it("does not mutate questions belonging to other assignments even when payload ids collide", async () => {
    // Assignment 1 has zero existing rows. Payload claims id 1001 which exists
    // in a foreign assignment (modeled by NOT seeding it in the assignment-1
    // bucket). The fix must route to create instead of mutating any row by id.
    const existing = new Map<number, any[]>([[1, []]]);
    await buildModule(existing);

    const payload = buildPayload({
      questions: [
        {
          id: 1001,
          assignmentId: 1,
          alreadyInBackend: false,
          type: QuestionType.TEXT,
          question: "TARGET_NEW",
          totalPoints: 1,
          variants: [],
        } as any,
      ],
    });

    await service.runPublishJob("job-1", 1, payload, "user-a");

    const created = prismaCalls.filter((c) => c.method === "question.create");
    const updated = prismaCalls.filter(
      (c) => c.method === "question.updateMany",
    );
    const upserted = prismaCalls.filter((c) => c.method === "question.upsert");

    expect(upserted).toHaveLength(0);
    expect(created).toHaveLength(1);
    expect(created[0].args.data.question).toBe("TARGET_NEW");
    expect(created[0].args.data.assignment).toEqual({ connect: { id: 1 } });

    // Orphan deletion (which uses updateMany with isDeleted: true) must not have
    // touched id 1001, because it does not exist in this assignment's scope.
    const orphanCalls = updated.filter((c) => c.args?.data?.isDeleted === true);
    for (const call of orphanCalls) {
      const ids = call.args?.where?.id?.in ?? [];
      expect(ids).not.toContain(1001);
    }
  });

  it("orphan detection still works under the new claim-based basis", async () => {
    // Assignment 1 has one existing row (id 5001). Payload claims id 999999999.
    // No payload entry claims 5001, so 5001 must be orphan-deleted; the new
    // entry must be created (NOT mutated by id).
    const existing = new Map<number, any[]>([
      [
        1,
        [
          {
            id: 5001,
            assignmentId: 1,
            isDeleted: false,
            question: "OLD",
            variants: [],
          },
        ],
      ],
    ]);
    await buildModule(existing);

    const payload = buildPayload({
      questions: [
        {
          id: 999999999,
          assignmentId: 1,
          alreadyInBackend: false,
          type: QuestionType.TEXT,
          question: "Q1",
          totalPoints: 1,
          variants: [],
        } as any,
      ],
    });

    await service.runPublishJob("job-1", 1, payload, "user-a");

    const created = prismaCalls.filter((c) => c.method === "question.create");
    const upserted = prismaCalls.filter((c) => c.method === "question.upsert");

    expect(upserted).toHaveLength(0);
    expect(created).toHaveLength(1);
    expect(created[0].args.data.question).toBe("Q1");

    const orphanDelete = prismaCalls.find(
      (c) =>
        c.method === "question.updateMany" && c.args?.data?.isDeleted === true,
    );
    expect(orphanDelete).toBeDefined();
    expect(orphanDelete?.args?.where?.id?.in).toEqual([5001]);
  });

  it("updates an existing row in place when the payload claims it", async () => {
    const existing = new Map<number, any[]>([
      [
        1,
        [
          {
            id: 7001,
            assignmentId: 1,
            isDeleted: false,
            question: "Q_OLD",
            variants: [],
          },
        ],
      ],
    ]);
    await buildModule(existing);

    const payload = buildPayload({
      questions: [
        {
          id: 7001,
          assignmentId: 1,
          alreadyInBackend: true,
          type: QuestionType.TEXT,
          question: "Q_NEW",
          totalPoints: 1,
          variants: [],
        } as any,
      ],
    });

    await service.runPublishJob("job-1", 1, payload, "user-a");

    const created = prismaCalls.filter((c) => c.method === "question.create");
    const upserted = prismaCalls.filter((c) => c.method === "question.upsert");
    const writeUpdates = prismaCalls.filter(
      (c) =>
        c.method === "question.updateMany" &&
        c.args?.data?.isDeleted !== true &&
        typeof c.args?.where?.id === "number",
    );

    expect(upserted).toHaveLength(0);
    expect(created).toHaveLength(0);
    expect(writeUpdates).toHaveLength(1);
    expect(writeUpdates[0].args.where).toEqual({
      id: 7001,
      assignmentId: 1,
    });
    expect(writeUpdates[0].args.data.question).toBe("Q_NEW");
    // updateMany cannot accept relation-connect operators; the data payload
    // for the matched-update branch must omit assignment.connect.
    expect(writeUpdates[0].args.data.assignment).toBeUndefined();
  });
});
