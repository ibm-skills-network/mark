/* eslint-disable */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { QuestionType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { UserRole } from "../../../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../../../database/prisma.service";
import { QuestionService } from "../../../assignment/question/question.service";
import { GithubRateLimitedError } from "../../../llm/features/grading/errors/github-rate-limited.error";
import { OversizedSubmissionError } from "../../../llm/features/grading/errors/oversized-submission.error";
import { UnsupportedImageFormatError } from "../../../llm/features/grading/errors/unsupported-image-format.error";
import { LocalizationService } from "../../common/utils/localization.service";
import { GradingFactoryService } from "../grading-factory.service";
import { GradingRateLimiterService } from "../grading-rate-limiter.service";
import {
  GradedItem,
  QuestionResponseService,
} from "./question-response.service";

const mockRateLimiter = {
  schedule: jest.fn(async (_name: string, op: () => Promise<any>) => op()),
};

describe("QuestionResponseService", () => {
  let service: QuestionResponseService;

  const mockPrisma = {
    assignmentAttempt: {
      findUnique: jest.fn(),
    },
  };

  const mockQuestionService = {
    findOne: jest.fn(),
  };

  const mockLocalizationService = {};
  const mockGradingFactoryService = {};

  const mockLogger = {
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuestionResponseService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: QuestionService, useValue: mockQuestionService },
        { provide: LocalizationService, useValue: mockLocalizationService },
        { provide: GradingFactoryService, useValue: mockGradingFactoryService },
        { provide: GradingRateLimiterService, useValue: mockRateLimiter },
        { provide: WINSTON_MODULE_PROVIDER, useValue: mockLogger },
        { provide: "GradingProgressService", useValue: undefined },
      ],
    }).compile();

    service = module.get<QuestionResponseService>(QuestionResponseService);
    jest.clearAllMocks();
  });

  it("uses the base question id for variant questions", async () => {
    const assignmentAttempt = {
      id: 289110,
      questionVariants: [
        {
          questionId: 10383,
          questionVariant: {
            id: 2060,
            questionId: 10383,
            variantContent: "Multi-Active cultures are most likely to:",
            choices: null,
            maxWords: null,
            maxCharacters: null,
            scoring: null,
            answer: null,
            variantOf: {
              id: 10383,
              type: QuestionType.SINGLE_CORRECT,
              assignmentId: 2991,
              maxWords: null,
              maxCharacters: null,
              scoring: null,
              choices: null,
              answer: null,
              totalPoints: 1,
              responseType: "OTHER",
              gradingContextQuestionIds: [],
            },
          },
        },
      ],
    };

    mockPrisma.assignmentAttempt.findUnique.mockResolvedValue(
      assignmentAttempt,
    );

    jest
      .spyOn(
        service as unknown as { getAssignmentContext: (...args: any[]) => any },
        "getAssignmentContext",
      )
      .mockResolvedValue({
        assignmentInstructions: "",
        questionAnswerContext: [],
      });

    const result = await (
      service as unknown as {
        getLearnerQuestion: (
          questionId: number,
          assignmentAttemptId: number,
          assignmentId: number,
        ) => Promise<{
          question: { id: number; question: string; type: QuestionType };
        }>;
      }
    ).getLearnerQuestion(10383, 289110, 2991);

    expect(result.question.id).toBe(10383);
    expect(result.question.id).not.toBe(2060);
    expect(result.question.question).toBe(
      "Multi-Active cultures are most likely to:",
    );
    expect(result.question.type).toBe(QuestionType.SINGLE_CORRECT);
    expect(mockQuestionService.findOne).not.toHaveBeenCalled();
  });
});

describe("QuestionResponseService — gradeQuestionsForLearner", () => {
  let service: QuestionResponseService;

  const mockTx = {
    assignmentAttempt: { findUnique: jest.fn(), updateMany: jest.fn() },
    questionResponse: { create: jest.fn(), findMany: jest.fn() },
    assignment: { findUnique: jest.fn() },
    question: { findUnique: jest.fn(), findMany: jest.fn() },
  };

  const mockPrisma = {
    assignmentAttempt: { findUnique: jest.fn(), updateMany: jest.fn() },
    $transaction: jest
      .fn()
      .mockImplementation(async (cb: (tx: typeof mockTx) => Promise<unknown>) =>
        cb(mockTx),
      ),
    assignment: { findUnique: jest.fn() },
    question: { findUnique: jest.fn(), findMany: jest.fn() },
    questionResponse: { create: jest.fn(), findMany: jest.fn() },
  };

  const mockProgressService = {
    initializeProgress: jest.fn(),
    updateProgress: jest.fn(),
    updateQuestionProgress: jest.fn(),
    markComplete: jest.fn(),
    markFailed: jest.fn(),
  };

  const mockLogger = {
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuestionResponseService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: QuestionService, useValue: { findOne: jest.fn() } },
        { provide: LocalizationService, useValue: {} },
        { provide: GradingFactoryService, useValue: {} },
        { provide: GradingRateLimiterService, useValue: mockRateLimiter },
        { provide: WINSTON_MODULE_PROVIDER, useValue: mockLogger },
        { provide: "GradingProgressService", useValue: mockProgressService },
      ],
    }).compile();

    service = module.get<QuestionResponseService>(QuestionResponseService);
    jest.clearAllMocks();

    // By default $transaction executes the callback
    mockPrisma.$transaction.mockImplementation(
      async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx),
    );

    // Phase 0 hoist runs unconditionally; mocks must return iterable defaults.
    mockPrisma.question.findMany.mockResolvedValue([]);
    mockPrisma.assignment.findUnique.mockResolvedValue(null);
  });

  function spyPrivate<K extends string>(
    method: K,
    implementation?: (...args: any[]) => any,
  ) {
    return jest
      .spyOn(
        service as unknown as Record<K, (...args: any[]) => any>,
        method as any,
      )
      .mockImplementation(implementation ?? jest.fn());
  }

  it("returns GradedItem[] for each question with no DB writes in Phase 2", async () => {
    const questionDto = {
      id: 1,
      question: "What is 2+2?",
      type: QuestionType.TEXT,
      gradingContextQuestionIds: [],
      totalPoints: 5,
      responseType: "TEXT",
    };
    const responseDto = {
      questionId: 1,
      question: "What is 2+2?",
      points: 5,
      totalPoints: 5,
      feedback: [],
    };

    spyPrivate("getLearnerQuestion", async () => ({
      question: questionDto,
      assignmentContext: {
        assignmentInstructions: "",
        questionAnswerContext: [],
      },
    }));
    spyPrivate("buildAndSortDependencies", () => ({
      sorted: [1],
      adj: new Map(),
      inDegree: new Map([[1, 0]]),
    }));
    spyPrivate("getAssignmentContext", async () => ({
      assignmentInstructions: "Do your best",
      questionAnswerContext: [],
    }));
    spyPrivate("gradeQuestionNoSave", async () => ({
      learnerResponse: "4",
      responseDto,
    }));

    const requests = [
      { id: 1, learnerTextResponse: "4", language: "en" },
    ] as any[];

    const items = await service.gradeQuestionsForLearner(requests, 10, 5, "en");

    expect(items).toHaveLength(1);
    expect(items[0].questionId).toBe(1);
    expect(items[0].learnerResponse).toBe("4");
    // No DB writes should occur in phases 1+2
    expect(mockPrisma.questionResponse.create).not.toHaveBeenCalled();
  });

  it("updates GradingProgress for each question", async () => {
    const questionDto = {
      id: 2,
      question: "Explain gravity",
      type: QuestionType.TEXT,
      gradingContextQuestionIds: [],
      totalPoints: 10,
      responseType: "TEXT",
    };

    spyPrivate("getLearnerQuestion", async () => ({
      question: questionDto,
      assignmentContext: {
        assignmentInstructions: "",
        questionAnswerContext: [],
      },
    }));
    spyPrivate("buildAndSortDependencies", () => ({
      sorted: [2],
      adj: new Map(),
      inDegree: new Map([[2, 0]]),
    }));
    spyPrivate("getAssignmentContext", async () => ({
      assignmentInstructions: "",
      questionAnswerContext: [],
    }));
    spyPrivate("gradeQuestionNoSave", async () => ({
      learnerResponse: "objects attract",
      responseDto: {
        questionId: 2,
        question: "Explain gravity",
        points: 10,
        totalPoints: 10,
        feedback: [],
      },
    }));

    await service.gradeQuestionsForLearner(
      [{ id: 2, language: "en" }] as any[],
      20,
      5,
      "en",
    );

    expect(mockProgressService.initializeProgress).toHaveBeenCalledWith(20, 1);
    expect(mockProgressService.updateQuestionProgress).toHaveBeenCalledWith(
      20,
      1,
      1,
      "Grading question 1 of 1...",
    );
    // Grading no longer flips the progress row; the caller does that after
    // the responses and grade commit.
    expect(mockProgressService.markComplete).not.toHaveBeenCalled();
  });

  it("exposes markGradingComplete so the caller can flip the row post-commit", async () => {
    await service.markGradingComplete(20);

    expect(mockProgressService.markComplete).toHaveBeenCalledWith(20);
  });

  it("marks the legacy submitQuestions path complete only after its write phase", async () => {
    const callOrder: string[] = [];

    const questionDto = {
      id: 3,
      question: "Explain entropy",
      type: QuestionType.TEXT,
      gradingContextQuestionIds: [],
      totalPoints: 10,
      responseType: "TEXT",
    };

    spyPrivate("getLearnerQuestion", async () => ({
      question: questionDto,
      assignmentContext: {
        assignmentInstructions: "",
        questionAnswerContext: [],
      },
    }));
    spyPrivate("buildAndSortDependencies", () => ({
      sorted: [3],
      adj: new Map(),
      inDegree: new Map([[3, 0]]),
    }));
    spyPrivate("getAssignmentContext", async () => ({
      assignmentInstructions: "",
      questionAnswerContext: [],
    }));
    spyPrivate("gradeQuestionNoSave", async () => ({
      learnerResponse: "disorder increases",
      responseDto: {
        questionId: 3,
        question: "Explain entropy",
        points: 10,
        totalPoints: 10,
        feedback: [],
      },
    }));
    spyPrivate("saveResponseToDatabase", async () => {
      callOrder.push("write");
    });
    mockProgressService.markComplete.mockImplementation(async () => {
      callOrder.push("markComplete");
    });

    await service.submitQuestions(
      [{ id: 3, language: "en" }] as any[],
      30,
      UserRole.LEARNER,
      5,
      "en",
    );

    expect(callOrder).toEqual(["write", "markComplete"]);
  });

  it("stores context responses in-memory so subsequent questions can reference them without a DB call", async () => {
    const q1 = {
      id: 10,
      question: "Q1",
      type: QuestionType.TEXT,
      gradingContextQuestionIds: [],
      totalPoints: 5,
      responseType: "TEXT",
    };
    const q2 = {
      id: 11,
      question: "Q2 referencing Q1",
      type: QuestionType.TEXT,
      gradingContextQuestionIds: [10],
      totalPoints: 5,
      responseType: "TEXT",
    };

    spyPrivate("getLearnerQuestion", async (qId: number) => ({
      question: qId === 10 ? q1 : q2,
      assignmentContext: {
        assignmentInstructions: "",
        questionAnswerContext: [],
      },
    }));
    spyPrivate("buildAndSortDependencies", () => ({
      sorted: [10, 11],
      adj: new Map([
        [10, [11]],
        [11, []],
      ]),
      inDegree: new Map([
        [10, 0],
        [11, 1],
      ]),
    }));

    const contextSpy = spyPrivate("getAssignmentContext", async () => ({
      assignmentInstructions: "",
      questionAnswerContext: [],
    }));

    spyPrivate("gradeQuestionNoSave", async (q: any) => ({
      learnerResponse: `answer for ${q.id}`,
      responseDto: {
        questionId: q.id,
        question: q.question,
        points: 5,
        totalPoints: 5,
        feedback: [],
      },
    }));

    await service.gradeQuestionsForLearner(
      [
        { id: 10, language: "en" },
        { id: 11, language: "en" },
      ] as any[],
      30,
      5,
      "en",
    );

    // The second call to getAssignmentContext should receive the in-memory map
    const secondContextCall = (contextSpy as jest.Mock).mock
      .calls[1] as unknown[];
    const inMemoryMap = secondContextCall[4] as Map<number, string>;
    expect(inMemoryMap).toBeInstanceOf(Map);
    expect(inMemoryMap.has(10)).toBe(true);
  });
});

describe("QuestionResponseService — commitAttemptWithResponses", () => {
  let service: QuestionResponseService;

  const mockTx = {
    assignmentAttempt: { updateMany: jest.fn(), findUnique: jest.fn() },
    questionResponse: { create: jest.fn(), findMany: jest.fn() },
  };

  const mockPrisma = {
    assignmentAttempt: { findUnique: jest.fn() },
    $transaction: jest
      .fn()
      .mockImplementation(
        async (cb: (tx: typeof mockTx) => Promise<unknown>, _opts?: any) =>
          cb(mockTx),
      ),
    questionResponse: { create: jest.fn(), findMany: jest.fn() },
  };

  const mockLogger = {
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    }),
  };

  const baseUpdateDto = {
    responsesForQuestions: [],
    language: "en",
  } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuestionResponseService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: QuestionService, useValue: { findOne: jest.fn() } },
        { provide: LocalizationService, useValue: {} },
        { provide: GradingFactoryService, useValue: {} },
        { provide: GradingRateLimiterService, useValue: mockRateLimiter },
        { provide: WINSTON_MODULE_PROVIDER, useValue: mockLogger },
        { provide: "GradingProgressService", useValue: undefined },
      ],
    }).compile();

    service = module.get<QuestionResponseService>(QuestionResponseService);
    jest.clearAllMocks();

    mockPrisma.$transaction.mockImplementation(
      async (cb: (tx: typeof mockTx) => Promise<unknown>, _opts?: any) =>
        cb(mockTx),
    );
  });

  it("throws NotFoundException when the attempt does not exist", async () => {
    mockPrisma.assignmentAttempt.findUnique.mockResolvedValue(null);

    await expect(
      service.commitAttemptWithResponses(999, [], 0, baseUpdateDto),
    ).rejects.toThrow(NotFoundException);
  });

  it("throws ConflictException when the attempt is already submitted", async () => {
    mockPrisma.assignmentAttempt.findUnique.mockResolvedValue({
      submitted: true,
    });

    await expect(
      service.commitAttemptWithResponses(50, [], 80, baseUpdateDto),
    ).rejects.toThrow(ConflictException);
  });

  it("throws ConflictException when updateMany count is 0 (concurrent submission)", async () => {
    mockPrisma.assignmentAttempt.findUnique.mockResolvedValue({
      submitted: false,
    });

    // Spy on saveResponseToDatabase so it doesn't throw
    jest
      .spyOn(service as any, "saveResponseToDatabase")
      .mockResolvedValue(undefined);

    // updateMany returns count=0 -> attempt was submitted concurrently
    mockTx.assignmentAttempt.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.commitAttemptWithResponses(50, [], 80, baseUpdateDto),
    ).rejects.toThrow(ConflictException);
  });

  it("writes all GradedItems and updates the attempt atomically on success", async () => {
    mockPrisma.assignmentAttempt.findUnique.mockResolvedValue({
      submitted: false,
    });

    const saveResponseSpy = jest
      .spyOn(service as any, "saveResponseToDatabase")
      .mockResolvedValue(undefined);

    mockTx.assignmentAttempt.updateMany.mockResolvedValue({ count: 1 });
    mockTx.assignmentAttempt.findUnique.mockResolvedValue({
      id: 50,
      submitted: true,
      grade: 85,
    });

    const gradedItems: GradedItem[] = [
      {
        questionId: 1,
        learnerResponse: "foo",
        responseDto: { questionId: 1 } as any,
      },
      {
        questionId: 2,
        learnerResponse: "bar",
        responseDto: { questionId: 2 } as any,
      },
    ];

    const result = await service.commitAttemptWithResponses(
      50,
      gradedItems,
      85,
      baseUpdateDto,
    );

    expect(saveResponseSpy).toHaveBeenCalledTimes(2);
    expect(mockTx.assignmentAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 50, submitted: false },
        data: expect.objectContaining({
          submitted: true,
          grade: 85,
        }),
      }),
    );
    expect(result).toEqual({ id: 50, submitted: true, grade: 85 });
  });
});

// ─── getAssignmentContext: in-memory context lookup (Change 2) ────────────────

describe("QuestionResponseService — getAssignmentContext with in-memory responses", () => {
  let service: QuestionResponseService;

  const mockPrisma = {
    assignment: { findUnique: jest.fn() },
    question: { findUnique: jest.fn(), findMany: jest.fn() },
    questionResponse: { findMany: jest.fn() },
    assignmentAttempt: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };

  const mockLogger = {
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuestionResponseService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: QuestionService, useValue: { findOne: jest.fn() } },
        { provide: LocalizationService, useValue: {} },
        { provide: GradingFactoryService, useValue: {} },
        { provide: GradingRateLimiterService, useValue: mockRateLimiter },
        { provide: WINSTON_MODULE_PROVIDER, useValue: mockLogger },
        { provide: "GradingProgressService", useValue: undefined },
      ],
    }).compile();

    service = module.get<QuestionResponseService>(QuestionResponseService);
    jest.clearAllMocks();
  });

  const callGetAssignmentContext = (inMemoryResponses?: Map<number, string>) =>
    (service as any).getAssignmentContext(
      5, // assignmentId
      20, // questionId
      10, // assignmentAttemptId
      undefined,
      inMemoryResponses,
    ) as Promise<{
      assignmentInstructions: string;
      questionAnswerContext: { question: string; answer: string }[];
    }>;

  it("returns empty context when question has no gradingContextQuestionIds", async () => {
    mockPrisma.assignment.findUnique.mockResolvedValue({
      instructions: "Read carefully",
    });
    mockPrisma.question.findUnique.mockResolvedValue({
      gradingContextQuestionIds: [],
    });

    const ctx = await callGetAssignmentContext();

    expect(ctx.assignmentInstructions).toBe("Read carefully");
    expect(ctx.questionAnswerContext).toHaveLength(0);
    expect(mockPrisma.questionResponse.findMany).not.toHaveBeenCalled();
  });

  it("uses in-memory responses and skips the DB lookup for context questions", async () => {
    mockPrisma.assignment.findUnique.mockResolvedValue({ instructions: "" });
    mockPrisma.question.findUnique.mockResolvedValue({
      gradingContextQuestionIds: [30],
    });
    mockPrisma.question.findMany.mockResolvedValue([
      { id: 30, question: "Context question?", type: QuestionType.TEXT },
    ]);
    // DB would return nothing — but in-memory should take precedence
    mockPrisma.questionResponse.findMany.mockResolvedValue([]);

    const inMemory = new Map<number, string>([
      [30, JSON.stringify("In-memory answer")],
    ]);
    const ctx = await callGetAssignmentContext(inMemory);

    // questionResponse.findMany should NOT be called because in-memory covers all context questions
    expect(mockPrisma.questionResponse.findMany).not.toHaveBeenCalled();
    expect(ctx.questionAnswerContext).toHaveLength(1);
    expect(ctx.questionAnswerContext[0].answer).toBe(
      JSON.stringify("In-memory answer"),
    );
  });

  it("falls back to the DB for context questions not yet in memory", async () => {
    mockPrisma.assignment.findUnique.mockResolvedValue({ instructions: "" });
    mockPrisma.question.findUnique.mockResolvedValue({
      gradingContextQuestionIds: [40],
    });
    mockPrisma.question.findMany.mockResolvedValue([
      { id: 40, question: "Context Q?", type: QuestionType.TEXT },
    ]);
    mockPrisma.questionResponse.findMany.mockResolvedValue([
      { questionId: 40, learnerResponse: JSON.stringify("DB answer") },
    ]);

    // Empty in-memory map — all context responses must come from DB
    const ctx = await callGetAssignmentContext(new Map());

    expect(mockPrisma.questionResponse.findMany).toHaveBeenCalledTimes(1);
    expect(ctx.questionAnswerContext[0].answer).toBe(
      JSON.stringify("DB answer"),
    );
  });

  it("throws NotFoundException when the assignment is not found", async () => {
    mockPrisma.assignment.findUnique.mockResolvedValue(null);

    await expect(callGetAssignmentContext()).rejects.toThrow(NotFoundException);
  });

  it("throws NotFoundException when the question is not found", async () => {
    mockPrisma.assignment.findUnique.mockResolvedValue({ instructions: "" });
    mockPrisma.question.findUnique.mockResolvedValue(null);

    await expect(callGetAssignmentContext()).rejects.toThrow(NotFoundException);
  });
});

// ─── gradeQuestionNoSave: typed terminal errors pass through unchanged ────────

describe("QuestionResponseService — gradeQuestionNoSave error handling", () => {
  let service: QuestionResponseService;

  // A grading strategy whose gradeResponse throws — the catch block under test
  // wraps the call at gradeResponse(...).
  const mockStrategy = {
    validateResponse: jest.fn().mockResolvedValue(true),
    extractLearnerResponse: jest.fn().mockResolvedValue("learner text"),
    gradeResponse: jest.fn(),
  };

  const mockGradingFactoryService = {
    getStrategy: jest.fn().mockReturnValue(mockStrategy),
  };

  const mockLogger = {
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    }),
  };

  // A non-empty TEXT response so isEmptyResponse() returns false and execution
  // reaches the strategy path (LINK_FILE is excluded by question.type).
  const question = {
    id: 7,
    question: "Explain entropy",
    type: QuestionType.TEXT,
    responseType: "TEXT",
    totalPoints: 5,
  } as any;
  const requestDto = {
    learnerTextResponse: "a non-empty answer",
    learnerAnswerChoice: null,
    language: "en",
  } as any;
  const assignmentContext = {
    assignmentInstructions: "",
    questionAnswerContext: [],
  };

  const callGradeQuestionNoSave = () =>
    (
      service as unknown as {
        gradeQuestionNoSave: (...args: any[]) => Promise<unknown>;
      }
    ).gradeQuestionNoSave(
      question,
      requestDto,
      assignmentContext,
      5, // assignmentId
      "en", // language
      UserRole.LEARNER,
      10, // assignmentAttemptId
    );

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuestionResponseService,
        { provide: PrismaService, useValue: {} },
        { provide: QuestionService, useValue: { findOne: jest.fn() } },
        { provide: LocalizationService, useValue: {} },
        {
          provide: GradingFactoryService,
          useValue: mockGradingFactoryService,
        },
        { provide: GradingRateLimiterService, useValue: mockRateLimiter },
        { provide: WINSTON_MODULE_PROVIDER, useValue: mockLogger },
        { provide: "GradingProgressService", useValue: undefined },
      ],
    }).compile();

    service = module.get<QuestionResponseService>(QuestionResponseService);
    jest.clearAllMocks();
    mockStrategy.validateResponse.mockResolvedValue(true);
    mockStrategy.extractLearnerResponse.mockResolvedValue("learner text");
    mockGradingFactoryService.getStrategy.mockReturnValue(mockStrategy);
  });

  it("rethrows OversizedSubmissionError unchanged (same instance)", async () => {
    const oversized = new OversizedSubmissionError({
      blockCount: 60_000,
      cap: 50_000,
      filename: "huge.xlsx",
    });
    mockStrategy.gradeResponse.mockRejectedValue(oversized);

    await expect(callGradeQuestionNoSave()).rejects.toBe(oversized);
  });

  it("rethrows UnsupportedImageFormatError unchanged (same instance)", async () => {
    const unsupported = new UnsupportedImageFormatError({
      filename: "photo.heic",
      detectedFormat: "image/heic",
      reason: "unsupported format detected at submission",
    });
    mockStrategy.gradeResponse.mockRejectedValue(unsupported);

    await expect(callGradeQuestionNoSave()).rejects.toBe(unsupported);
  });

  it("wraps a generic Error in BadRequestException with the technical message", async () => {
    mockStrategy.gradeResponse.mockRejectedValue(new Error("model exploded"));

    await expect(callGradeQuestionNoSave()).rejects.toThrow(
      BadRequestException,
    );
    await expect(callGradeQuestionNoSave()).rejects.toThrow(
      "Failed to process question response: model exploded",
    );
  });

  it("rethrows GithubRateLimitedError unchanged (same instance)", async () => {
    const rateLimited = new GithubRateLimitedError({
      owner: "octocat",
      repo: "hello-world",
      requestUrl: "https://api.github.com/repos/octocat/hello-world",
    });
    mockStrategy.gradeResponse.mockRejectedValue(rateLimited);

    await expect(callGradeQuestionNoSave()).rejects.toBe(rateLimited);
  });

  it("surfaces GithubRateLimitedError out of the public createQuestionResponse entry point with its class intact", async () => {
    const rateLimited = new GithubRateLimitedError({
      owner: "octocat",
      repo: "hello-world",
      requestUrl: "https://api.github.com/repos/octocat/hello-world",
    });
    mockStrategy.gradeResponse.mockRejectedValue(rateLimited);

    // Author path avoids the DB lookups the learner path needs — the point
    // here is the error's class survives the createQuestionResponse ->
    // gradeQuestionNoSave boundary, not the question-loading mechanics.
    const rejection = await service
      .createQuestionResponse(
        10, // assignmentAttemptId
        { ...requestDto, id: question.id },
        UserRole.AUTHOR,
        5, // assignmentId
        "en",
        [question], // authorQuestions
      )
      .then(
        () => {
          throw new Error("expected createQuestionResponse to reject");
        },
        (error: unknown) => error,
      );

    expect(rejection).toBe(rateLimited);
    expect(rejection).toBeInstanceOf(GithubRateLimitedError);
  });
});
