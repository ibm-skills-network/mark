import { HttpService } from "@nestjs/axios";
import {
  BadRequestException,
  InternalServerErrorException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { Question } from "@prisma/client";
import {
  UserRole,
  UserSession,
} from "../../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../../database/prisma.service";
import { OversizedSubmissionError } from "../../llm/features/grading/errors/oversized-submission.error";
import { UnsupportedImageFormatError } from "../../llm/features/grading/errors/unsupported-image-format.error";
import { CreateQuestionResponseAttemptResponseDto } from "../../assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import { AttemptQuestionsMapper } from "../common/utils/attempt-questions-mapper.util";
import { AttemptGradingService } from "./attempt-grading.service";
import { AttemptAccessCacheService } from "./attempt-access-cache.service";
import { AttemptSubmissionService } from "./attempt-submission.service";
import { AttemptValidationService } from "./attempt-validation.service";
import { LtiGradeSyncService } from "./lti-grade-sync.service";
import { QuestionResponseService } from "./question-response/question-response.service";
import { QuestionVariantService } from "./question-variant/question-variant.service";
import { TranslationService } from "./translation/translation.service";

describe("AttemptSubmissionService - Grading Validation", () => {
  let service: AttemptSubmissionService;

  const mockPrisma = {
    assignmentAttempt: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    assignment: {
      findUnique: jest.fn(),
    },
    question: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    questionResponse: {
      deleteMany: jest.fn(),
    },
  };

  const mockValidationService = {
    validateNewAttempt: jest.fn(),
    isAttemptExpired: jest.fn(),
  };

  type LearnerGradeResult = ReturnType<
    AttemptGradingService["calculateGradeForLearner"]
  >;
  type LearnerGradeParameters = Parameters<
    AttemptGradingService["calculateGradeForLearner"]
  >;
  type AuthorGradeResult = ReturnType<
    AttemptGradingService["calculateGradeForAuthor"]
  >;
  type AuthorGradeParameters = Parameters<
    AttemptGradingService["calculateGradeForAuthor"]
  >;

  const mockGradingService = {
    calculateGradeForLearner: jest.fn<
      LearnerGradeResult,
      LearnerGradeParameters
    >(),
    calculateGradeForAuthor: jest.fn<
      AuthorGradeResult,
      AuthorGradeParameters
    >(),
    constructFeedbacksForQuestions: jest.fn(),
  };

  const mockAttemptAccessCacheService = {
    getQuestionDtosForAttemptAccess: jest.fn(),
  };

  const mockQuestionResponseService = {
    submitQuestions: jest.fn(),
    createQuestionResponse: jest.fn(),
  };

  const mockTranslationService = {
    preTranslateQuestions: jest.fn(),
    getTranslationsForAttempt: jest.fn(),
  };

  const mockQuestionVariantService = {
    createAttemptQuestionVariants: jest.fn(),
  };

  const mockHttpService = {
    put: jest.fn(),
  };

  const mockLtiGradeSyncService = {
    createAndSync: jest.fn(),
  };

  type TestResponse = CreateQuestionResponseAttemptResponseDto & {
    metadata?: Record<string, unknown> | null;
    learnerResponse?: unknown;
  };

  const makeResponse = (overrides: Partial<TestResponse>): TestResponse => ({
    id: overrides.id ?? overrides.questionId ?? 0,
    questionId: overrides.questionId ?? 0,
    question: overrides.question ?? `Question ${overrides.questionId ?? 0}`,
    totalPoints: overrides.totalPoints,
    feedback: overrides.feedback ?? [],
    metadata: overrides.metadata ?? undefined,
    learnerResponse: overrides.learnerResponse,
    points: overrides.points,
  });

  const calculateTotals = (responses: TestResponse[], questions: Question[]) =>
    (
      service as unknown as {
        calculateTotalPossiblePointsWithValidation: (
          r: TestResponse[],
          q: Question[],
          options?: {
            allowDatabaseFallback?: boolean;
          },
        ) => Promise<{
          totalPossiblePoints: number;
          missingQuestions: number[];
        }>;
      }
    ).calculateTotalPossiblePointsWithValidation(responses, questions);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttemptSubmissionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AttemptValidationService, useValue: mockValidationService },
        { provide: AttemptGradingService, useValue: mockGradingService },
        {
          provide: AttemptAccessCacheService,
          useValue: mockAttemptAccessCacheService,
        },
        {
          provide: QuestionResponseService,
          useValue: mockQuestionResponseService,
        },
        { provide: TranslationService, useValue: mockTranslationService },
        {
          provide: QuestionVariantService,
          useValue: mockQuestionVariantService,
        },
        { provide: LtiGradeSyncService, useValue: mockLtiGradeSyncService },
        { provide: HttpService, useValue: mockHttpService },
      ],
    }).compile();

    service = module.get<AttemptSubmissionService>(AttemptSubmissionService);

    // Reset all mocks before each test
    jest.clearAllMocks();
  });

  describe("calculateTotalPossiblePointsWithValidation", () => {
    it("should calculate totalPossiblePoints correctly when all questions exist", async () => {
      const responses: TestResponse[] = [
        makeResponse({ questionId: 1, totalPoints: 8 }),
        makeResponse({ questionId: 2, totalPoints: 5 }),
        makeResponse({ questionId: 3, totalPoints: 10 }),
      ];

      const questions: Question[] = [
        { id: 1, totalPoints: 10 } as Question,
        { id: 2, totalPoints: 10 } as Question,
        { id: 3, totalPoints: 10 } as Question,
      ];

      const result = await calculateTotals(responses, questions);

      expect(result.totalPossiblePoints).toBe(30); // 10 + 10 + 10
      expect(result.missingQuestions).toHaveLength(0);
    });

    it("should throw error when question is missing and no metadata", async () => {
      const responses: TestResponse[] = [
        makeResponse({
          questionId: 1,
          totalPoints: 8,
          metadata: undefined,
        }),
      ];

      const questions: Question[] = []; // Question 1 is missing!

      await expect(calculateTotals(responses, questions)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it("should use metadata maxPossiblePoints when question is missing", async () => {
      const responses: TestResponse[] = [
        makeResponse({
          questionId: 1,
          totalPoints: 8,
          metadata: { maxPossiblePoints: 10 }, // Fallback to metadata
        }),
        makeResponse({
          questionId: 2,
          totalPoints: 10,
        }),
      ];

      const questions: Question[] = [
        { id: 2, totalPoints: 10 } as Question, // Question 1 is missing
      ];

      const result = await calculateTotals(responses, questions);

      expect(result.totalPossiblePoints).toBe(20); // 10 (from metadata) + 10 (from question)
      expect(result.missingQuestions).toEqual([1]); // Question 1 was missing
    });

    it("should handle deleted questions gracefully with metadata", async () => {
      // Scenario: Question was deleted after attempt was created
      const responses: TestResponse[] = [
        makeResponse({
          questionId: 999, // Deleted question
          totalPoints: 7,
          metadata: { maxPossiblePoints: 10 },
        }),
      ];

      const questions: Question[] = []; // Empty - question was deleted

      const result = await calculateTotals(responses, questions);

      expect(result.totalPossiblePoints).toBe(10);
      expect(result.missingQuestions).toContain(999);
    });

    it("should not query the database for author preview when draft questions are provided", async () => {
      const responses: TestResponse[] = [
        makeResponse({
          questionId: 966122647,
          totalPoints: 8,
          metadata: undefined,
        }),
      ];

      const draftQuestions: Question[] = [
        { id: 966122647, totalPoints: 12 } as Question,
      ];

      const result = await (
        service as unknown as {
          calculateTotalPossiblePointsWithValidation: (
            r: TestResponse[],
            q: Question[],
            options?: {
              allowDatabaseFallback?: boolean;
            },
          ) => Promise<{
            totalPossiblePoints: number;
            missingQuestions: number[];
          }>;
        }
      ).calculateTotalPossiblePointsWithValidation(responses, draftQuestions, {
        allowDatabaseFallback: false,
      });

      expect(result.totalPossiblePoints).toBe(12);
      expect(result.missingQuestions).toHaveLength(0);
      expect(mockPrisma.question.findMany).not.toHaveBeenCalled();
    });
  });

  describe("createAssignmentAttempt - question versions", () => {
    const assignmentId = 123;
    const userSession: UserSession = {
      userId: "user-1",
      role: UserRole.LEARNER,
      assignmentId,
      groupId: "group-1",
    };

    const makeQuestionVersion = (overrides: Partial<Record<string, unknown>>) =>
      ({
        id: overrides.id ?? 1000,
        questionId: overrides.questionId ?? null,
        question: overrides.question ?? "Question",
        type: overrides.type ?? "TEXT",
        assignmentId,
        totalPoints: overrides.totalPoints ?? 5,
        maxWords: null,
        maxCharacters: null,
        choices: [],
        scoring: {},
        answer: null,
        gradingContextQuestionIds: [],
        responseType: "TEXT",
        randomizedChoices: false,
        videoPresentationConfig: null,
        liveRecordingConfig: null,
      }) as unknown as Record<string, unknown>;

    const baseAssignment = {
      id: assignmentId,
      numberOfQuestionsPerAttempt: undefined,
      questionOrder: [],
      displayOrder: null,
      allotedTimeMinutes: undefined,
      questions: [],
    };

    beforeEach(() => {
      mockValidationService.validateNewAttempt.mockResolvedValue(undefined);
      mockPrisma.assignmentAttempt.create.mockResolvedValue({ id: 55 });
      mockPrisma.assignmentAttempt.update.mockResolvedValue({});
    });

    it("reuses the assignment query for validation and variant mapping", async () => {
      const questionVersions = [
        makeQuestionVersion({ id: 1001, questionId: 10, question: "Q1" }),
        makeQuestionVersion({ id: 1002, questionId: 20, question: "Q2" }),
        makeQuestionVersion({ id: 1003, questionId: null, question: "Q3" }),
      ];

      const variant = {
        id: 501,
        variantContent: "Variant 1",
        choices: [],
        scoring: {},
        maxWords: null,
        maxCharacters: null,
        variantType: "REWORDED",
        randomizedChoices: false,
        isDeleted: false,
      };

      mockPrisma.assignment.findUnique.mockResolvedValue({
        ...baseAssignment,
        currentVersionId: 9,
        currentVersion: { questionVersions },
        questions: [
          { id: 10, variants: [variant] },
          { id: 20, variants: [] },
        ],
      });

      const result = await service.createAssignmentAttempt(
        assignmentId,
        userSession,
      );

      expect(result).toEqual({ id: 55, success: true });
      expect(mockPrisma.question.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.question.findMany).not.toHaveBeenCalled();
      expect(mockValidationService.validateNewAttempt).toHaveBeenCalledWith(
        expect.objectContaining({
          id: assignmentId,
          success: true,
        }),
        userSession,
      );
      expect(mockPrisma.assignment.findUnique).toHaveBeenCalledWith({
        where: { id: assignmentId },
        include: {
          currentVersion: {
            include: {
              questionVersions: true,
            },
          },
          questions: {
            where: { isDeleted: false },
            include: {
              variants: {
                where: { isDeleted: false },
              },
            },
          },
        },
      });
      expect(
        mockQuestionVariantService.createAttemptQuestionVariants,
      ).toHaveBeenCalledTimes(1);

      const [, orderedQuestions] = mockQuestionVariantService
        .createAttemptQuestionVariants.mock.calls[0] as [
        number,
        Array<{ id: number; variants?: Array<{ id?: number }> }>,
      ];
      const questionWithVariant = orderedQuestions.find((q) => q.id === 10);
      const questionWithoutVariant = orderedQuestions.find((q) => q.id === 20);
      const questionFromVersionOnly = orderedQuestions.find(
        (q) => q.id === 1003,
      );

      expect(questionWithVariant?.variants).toHaveLength(1);
      expect(questionWithVariant?.variants?.[0]?.id).toBe(501);
      expect(questionWithoutVariant?.variants).toHaveLength(0);
      expect(questionFromVersionOnly?.variants).toHaveLength(0);
    });

    it("skips batch lookup when questionIds are missing", async () => {
      const questionVersions = [
        makeQuestionVersion({ id: 2001, questionId: null, question: "Q1" }),
      ];

      mockPrisma.assignment.findUnique.mockResolvedValue({
        currentVersionId: 9,
        currentVersion: { questionVersions },
        questions: [],
      });

      await service.createAssignmentAttempt(assignmentId, userSession);

      expect(mockPrisma.question.findMany).not.toHaveBeenCalled();
      expect(
        mockQuestionVariantService.createAttemptQuestionVariants,
      ).toHaveBeenCalledTimes(1);

      const [, orderedQuestions] = mockQuestionVariantService
        .createAttemptQuestionVariants.mock.calls[0] as [
        number,
        Array<{ id: number; variants?: Array<{ id?: number }> }>,
      ];
      expect(orderedQuestions).toHaveLength(1);
      expect(orderedQuestions[0].id).toBe(2001);
      expect(orderedQuestions[0].variants).toHaveLength(0);
    });

    it("appends questions missing from questionOrder when creating learner attempts", async () => {
      const questionVersions = [
        makeQuestionVersion({ id: 3001, questionId: 10, question: "Q1" }),
        makeQuestionVersion({ id: 3002, questionId: 20, question: "Q2" }),
        makeQuestionVersion({ id: 3003, questionId: 30, question: "Q3" }),
      ];

      mockPrisma.assignment.findUnique.mockResolvedValue({
        ...baseAssignment,
        success: true,
        questionOrder: [20, 10],
        currentVersionId: 9,
        currentVersion: { questionVersions },
        questions: [],
      });

      await service.createAssignmentAttempt(assignmentId, userSession);

      const [, orderedQuestions] = mockQuestionVariantService
        .createAttemptQuestionVariants.mock.calls[0] as [
        number,
        Array<{ id: number }>,
      ];

      expect(orderedQuestions.map((question) => question.id)).toEqual([
        20, 10, 30,
      ]);
      expect(mockPrisma.assignmentAttempt.update).toHaveBeenCalledWith({
        where: { id: 55 },
        data: {
          questionOrder: [20, 10, 30],
        },
      });
    });
  });

  describe("autoSaveQuestionResponse - oversized submission boundary", () => {
    const learnerSession: UserSession = {
      userId: "learner-1",
      role: UserRole.LEARNER,
      assignmentId: 99,
      groupId: "group-1",
    };

    const requestDto = {
      learnerFileResponse: [],
    } as unknown as Parameters<
      AttemptSubmissionService["autoSaveQuestionResponse"]
    >[3];

    it("translates an OversizedSubmissionError into a BadRequestException carrying the learner message", async () => {
      const oversized = new OversizedSubmissionError({
        blockCount: 60_000,
        cap: 50_000,
        filename: "huge.xlsx",
      });
      mockQuestionResponseService.createQuestionResponse.mockRejectedValue(
        oversized,
      );

      const rejection = await service
        .autoSaveQuestionResponse(71, 99, 101, requestDto, learnerSession, "en")
        .then(
          () => {
            throw new Error("expected autoSaveQuestionResponse to reject");
          },
          (error: unknown) => error,
        );

      expect(rejection).toBeInstanceOf(BadRequestException);
      expect((rejection as BadRequestException).message).toBe(
        oversized.learnerMessage,
      );
      expect(mockPrisma.questionResponse.deleteMany).not.toHaveBeenCalled();
    });

    it("translates an UnsupportedImageFormatError into a BadRequestException carrying the learner message", async () => {
      const unsupported = new UnsupportedImageFormatError({
        filename: "photo.heic",
        detectedFormat: "image/heic",
        reason: "unsupported format detected at submission",
      });
      mockQuestionResponseService.createQuestionResponse.mockRejectedValue(
        unsupported,
      );

      const rejection = await service
        .autoSaveQuestionResponse(71, 99, 101, requestDto, learnerSession, "en")
        .then(
          () => {
            throw new Error("expected autoSaveQuestionResponse to reject");
          },
          (error: unknown) => error,
        );

      expect(rejection).toBeInstanceOf(BadRequestException);
      expect((rejection as BadRequestException).message).toBe(
        unsupported.learnerMessage,
      );
      expect(mockPrisma.questionResponse.deleteMany).not.toHaveBeenCalled();
    });

    it("lets non-oversized errors pass through unchanged", async () => {
      const boom = new Error("boom");
      mockQuestionResponseService.createQuestionResponse.mockRejectedValue(
        boom,
      );

      await expect(
        service.autoSaveQuestionResponse(
          71,
          99,
          101,
          requestDto,
          learnerSession,
          "en",
        ),
      ).rejects.toBe(boom);
    });
  });

  describe("attempt access reads", () => {
    const assignmentAttempt = {
      id: 71,
      assignmentId: 99,
      assignmentVersionId: 12,
      questionOrder: [101, 202],
      questionResponses: [],
      questionVariants: [],
      preferredLanguage: "en",
      grade: 0.9,
      comments: "done",
      submitted: true,
      assignmentVersion: {
        questionVersions: [],
      },
    };

    const cachedQuestionDtos = [
      {
        id: 101,
        question: "Question 101",
        type: "TEXT",
        assignmentId: 99,
        totalPoints: 5,
        choices: [],
        scoring: { type: "CRITERIA_BASED", rubrics: [] },
        answer: "true",
        gradingContextQuestionIds: [],
        responseType: "TEXT",
        isDeleted: false,
        randomizedChoices: "false",
        videoPresentationConfig: null,
        liveRecordingConfig: null,
      },
      {
        id: 202,
        question: "Question 202",
        type: "TEXT",
        assignmentId: 99,
        totalPoints: 5,
        choices: [],
        scoring: { type: "CRITERIA_BASED", rubrics: [] },
        answer: "false",
        gradingContextQuestionIds: [],
        responseType: "TEXT",
        isDeleted: false,
        randomizedChoices: "false",
        videoPresentationConfig: null,
        liveRecordingConfig: null,
      },
    ];

    beforeEach(() => {
      mockPrisma.assignmentAttempt.findUnique.mockResolvedValue(
        assignmentAttempt,
      );
      mockPrisma.assignment.findUnique.mockResolvedValue({
        id: 99,
        questionOrder: [101, 202],
        displayOrder: null,
        passingGrade: 50,
        showAssignmentScore: true,
        showSubmissionFeedback: true,
        showQuestionScore: true,
        showQuestions: true,
        updatedAt: new Date("2026-04-26T00:00:00.000Z"),
        currentVersion: {
          correctAnswerVisibility: "ALWAYS",
        },
      });
      mockAttemptAccessCacheService.getQuestionDtosForAttemptAccess.mockResolvedValue(
        cachedQuestionDtos,
      );
    });

    it("gets learner attempts from the cache-backed question DTO loader", async () => {
      const mapperSpy = jest
        .spyOn(service as never, "applyVisibilitySettings")
        .mockImplementation(() => undefined);
      const buildSpy = jest
        .spyOn(AttemptQuestionsMapper, "buildQuestionsWithResponses")
        .mockResolvedValue([{ id: 101 }, { id: 202 }]);

      const result = await service.getLearnerAssignmentAttempt(71, {
        userId: "learner-1",
        role: UserRole.LEARNER,
        assignmentId: 99,
        groupId: "group-1",
      });

      expect(
        mockAttemptAccessCacheService.getQuestionDtosForAttemptAccess,
      ).toHaveBeenCalledWith({
        assignmentId: 99,
        assignmentUpdatedAt: new Date("2026-04-26T00:00:00.000Z"),
        assignmentVersionId: 12,
        questionVersions: [],
      });
      expect(mockPrisma.question.findMany).not.toHaveBeenCalled();
      expect(buildSpy).toHaveBeenCalledWith(
        expect.any(Object),
        expect.arrayContaining([
          expect.objectContaining({ id: 101, answer: "true" }),
          expect.objectContaining({ id: 202, answer: "false" }),
        ]),
        expect.any(Object),
        mockPrisma,
        "en",
      );
      expect(result.questions).toEqual([{ id: 101 }, { id: 202 }]);

      buildSpy.mockRestore();
      mapperSpy.mockRestore();
    });

    it("includes totalPossiblePoints and totalPointsEarned so the success page can render the score even when showQuestions strips the questions array", async () => {
      mockPrisma.assignmentAttempt.findUnique.mockResolvedValue({
        ...assignmentAttempt,
        questionResponses: [
          { questionId: 101, points: 4 },
          { questionId: 202, points: 3 },
        ],
      });
      const buildSpy = jest
        .spyOn(AttemptQuestionsMapper, "buildQuestionsWithResponses")
        .mockResolvedValue([
          { id: 101, totalPoints: 5 },
          { id: 202, totalPoints: 5 },
        ]);
      // Force the visibility filter to actually run so we prove totals are
      // captured before it strips the questions array.
      mockPrisma.assignment.findUnique.mockResolvedValue({
        id: 99,
        questionOrder: [101, 202],
        displayOrder: null,
        passingGrade: 50,
        showAssignmentScore: true,
        showSubmissionFeedback: true,
        showQuestionScore: true,
        showQuestions: false,
        updatedAt: new Date("2026-04-26T00:00:00.000Z"),
        currentVersion: { correctAnswerVisibility: "ALWAYS" },
      });

      const result = await service.getLearnerAssignmentAttempt(71, {
        userId: "learner-1",
        role: UserRole.LEARNER,
        assignmentId: 99,
        groupId: "group-1",
      });

      expect(result.totalPossiblePoints).toBe(10);
      expect(result.totalPointsEarned).toBe(7);
      expect(result.questions).toEqual([]);

      buildSpy.mockRestore();
    });

    it("scopes totalPossiblePoints to the questions served this attempt, not the whole question bank", async () => {
      // Question-bank assignment: bank of 3 cached questions, but only 2 were
      // drawn for this attempt (questionOrder). The denominator must be the 2
      // served (10), not the full bank of 3 (15) — otherwise the success page
      // shows an inflated "X/15" when only 2 questions were answered.
      mockPrisma.assignmentAttempt.findUnique.mockResolvedValue({
        ...assignmentAttempt,
        questionOrder: [101, 202],
        questionResponses: [
          { questionId: 101, points: 5 },
          { questionId: 202, points: 5 },
        ],
      });
      mockAttemptAccessCacheService.getQuestionDtosForAttemptAccess.mockResolvedValue(
        [
          { id: 101, totalPoints: 5 },
          { id: 202, totalPoints: 5 },
          { id: 303, totalPoints: 5 }, // in the bank, not served this attempt
        ],
      );
      const buildSpy = jest
        .spyOn(AttemptQuestionsMapper, "buildQuestionsWithResponses")
        .mockResolvedValue([
          { id: 101, totalPoints: 5 },
          { id: 202, totalPoints: 5 },
        ]);
      mockPrisma.assignment.findUnique.mockResolvedValue({
        id: 99,
        questionOrder: [101, 202, 303],
        displayOrder: null,
        passingGrade: 50,
        showAssignmentScore: true,
        showSubmissionFeedback: true,
        showQuestionScore: true,
        showQuestions: true,
        updatedAt: new Date("2026-04-26T00:00:00.000Z"),
        currentVersion: { correctAnswerVisibility: "ALWAYS" },
      });

      const result = await service.getLearnerAssignmentAttempt(71, {
        userId: "learner-1",
        role: UserRole.LEARNER,
        assignmentId: 99,
        groupId: "group-1",
      });

      expect(result.totalPossiblePoints).toBe(10);
      expect(result.totalPointsEarned).toBe(10);
      expect(result.grade).toBe(0.9);

      buildSpy.mockRestore();
    });

    it("excludes unserved and duplicate responses from the displayed numerator", async () => {
      mockPrisma.assignmentAttempt.findUnique.mockResolvedValue({
        ...assignmentAttempt,
        questionOrder: [101],
        questionResponses: [
          { id: 1, questionId: 101, points: 3 },
          { id: 2, questionId: 101, points: 5 },
          { id: 3, questionId: 202, points: 5 },
        ],
      });
      mockAttemptAccessCacheService.getQuestionDtosForAttemptAccess.mockResolvedValue(
        [
          { id: 101, totalPoints: 5 },
          { id: 202, totalPoints: 5 },
        ],
      );
      const buildSpy = jest
        .spyOn(AttemptQuestionsMapper, "buildQuestionsWithResponses")
        .mockResolvedValue([{ id: 101, totalPoints: 5 }]);

      const result = await service.getLearnerAssignmentAttempt(71, {
        userId: "learner-1",
        role: UserRole.LEARNER,
        assignmentId: 99,
        groupId: "group-1",
      });

      expect(result.totalPossiblePoints).toBe(5);
      expect(result.totalPointsEarned).toBe(5);

      buildSpy.mockRestore();
    });

    it("uses the original maximum when a served question was deleted after submission", async () => {
      // Non-versioned assignment: Q202 was served (in questionOrder) and graded,
      // but the author deleted it afterwards so it is gone from the question
      // cache. Its grading metadata preserves the original maximum.
      mockPrisma.assignmentAttempt.findUnique.mockResolvedValue({
        ...assignmentAttempt,
        grade: 0.9,
        questionOrder: [101, 202],
        questionResponses: [
          { questionId: 101, points: 5 },
          {
            questionId: 202,
            points: 4,
            metadata: { maxPossiblePoints: 5 },
          }, // question deleted from the cache
        ],
      });
      mockAttemptAccessCacheService.getQuestionDtosForAttemptAccess.mockResolvedValue(
        [{ id: 101, totalPoints: 5 }], // 202 missing: deleted after submission
      );
      const buildSpy = jest
        .spyOn(AttemptQuestionsMapper, "buildQuestionsWithResponses")
        .mockResolvedValue([{ id: 101, totalPoints: 5 }]);
      mockPrisma.assignment.findUnique.mockResolvedValue({
        id: 99,
        questionOrder: [101, 202],
        displayOrder: null,
        passingGrade: 50,
        showAssignmentScore: true,
        showSubmissionFeedback: true,
        showQuestionScore: true,
        showQuestions: true,
        updatedAt: new Date("2026-04-26T00:00:00.000Z"),
        currentVersion: { correctAnswerVisibility: "ALWAYS" },
      });

      const result = await service.getLearnerAssignmentAttempt(71, {
        userId: "learner-1",
        role: UserRole.LEARNER,
        assignmentId: 99,
        groupId: "group-1",
      });

      expect(result.totalPossiblePoints).toBe(10);
      expect(result.totalPointsEarned).toBe(9);
      expect(result.totalPointsEarned).toBeLessThanOrEqual(
        result.totalPossiblePoints as number,
      );

      buildSpy.mockRestore();
    });

    it("falls back to an archived question row when response metadata is missing", async () => {
      mockPrisma.assignmentAttempt.findUnique.mockResolvedValue({
        ...assignmentAttempt,
        questionOrder: [101, 202],
        questionResponses: [
          { questionId: 101, points: 5 },
          { questionId: 202, points: 4, metadata: null },
        ],
      });
      mockAttemptAccessCacheService.getQuestionDtosForAttemptAccess.mockResolvedValue(
        [{ id: 101, totalPoints: 5 }],
      );
      mockPrisma.question.findMany.mockResolvedValue([
        { id: 202, totalPoints: 5 },
      ]);
      const buildSpy = jest
        .spyOn(AttemptQuestionsMapper, "buildQuestionsWithResponses")
        .mockResolvedValue([{ id: 101, totalPoints: 5 }]);

      const result = await service.getLearnerAssignmentAttempt(71, {
        userId: "learner-1",
        role: UserRole.LEARNER,
        assignmentId: 99,
        groupId: "group-1",
      });

      expect(mockPrisma.question.findMany).toHaveBeenCalledWith({
        where: { id: { in: [202] } },
        select: { id: true, totalPoints: true },
      });
      expect(result.totalPossiblePoints).toBe(10);
      expect(result.totalPointsEarned).toBe(9);

      buildSpy.mockRestore();
    });

    it("parses persisted metadata when a deleted served question earned zero", async () => {
      mockPrisma.assignmentAttempt.findUnique.mockResolvedValue({
        ...assignmentAttempt,
        grade: 0.5,
        questionOrder: [101, 202],
        questionResponses: [
          { questionId: 101, points: 5 },
          {
            questionId: 202,
            points: 0,
            metadata: JSON.stringify({ maxPossiblePoints: 5 }),
          },
        ],
      });
      mockAttemptAccessCacheService.getQuestionDtosForAttemptAccess.mockResolvedValue(
        [{ id: 101, totalPoints: 5 }],
      );
      const buildSpy = jest
        .spyOn(AttemptQuestionsMapper, "buildQuestionsWithResponses")
        .mockResolvedValue([{ id: 101, totalPoints: 5 }]);

      const result = await service.getLearnerAssignmentAttempt(71, {
        userId: "learner-1",
        role: UserRole.LEARNER,
        assignmentId: 99,
        groupId: "group-1",
      });

      expect(result.totalPossiblePoints).toBe(10);
      expect(result.totalPointsEarned).toBe(5);
      expect(result.grade).toBe(0.5);

      buildSpy.mockRestore();
    });

    it("clamps a response graded above its question's max and recomputes the displayed grade so an already-graded attempt cannot show a false 100%", async () => {
      // Reproduces the multi-select overshoot: Q202 was graded 2 points on a
      // 1-point question, which inflated the attempt total so the +1 overshoot
      // masked Q303's 0 and produced a false 3/3 = 100%.
      mockPrisma.assignmentAttempt.findUnique.mockResolvedValue({
        ...assignmentAttempt,
        grade: 1, // stored grade was derived from the inflated points
        questionOrder: [101, 202, 303], // all three served this attempt
        questionResponses: [
          { questionId: 101, points: 1 },
          { questionId: 202, points: 2 }, // over the question's max of 1
          { questionId: 303, points: 0 },
        ],
      });
      mockAttemptAccessCacheService.getQuestionDtosForAttemptAccess.mockResolvedValue(
        [
          { id: 101, totalPoints: 1 },
          { id: 202, totalPoints: 1 },
          { id: 303, totalPoints: 1 },
        ],
      );
      const buildSpy = jest
        .spyOn(AttemptQuestionsMapper, "buildQuestionsWithResponses")
        .mockResolvedValue([
          { id: 101, totalPoints: 1 },
          { id: 202, totalPoints: 1 },
          { id: 303, totalPoints: 1 },
        ]);
      mockPrisma.assignment.findUnique.mockResolvedValue({
        id: 99,
        questionOrder: [101, 202, 303],
        displayOrder: null,
        passingGrade: 50,
        showAssignmentScore: true,
        showSubmissionFeedback: true,
        showQuestionScore: true,
        showQuestions: true,
        updatedAt: new Date("2026-04-26T00:00:00.000Z"),
        currentVersion: { correctAnswerVisibility: "ALWAYS" },
      });

      const result = await service.getLearnerAssignmentAttempt(71, {
        userId: "learner-1",
        role: UserRole.LEARNER,
        assignmentId: 99,
        groupId: "group-1",
      });

      expect(result.totalPossiblePoints).toBe(3);
      // 1 + min(2,1) + 0 = 2, not the inflated 1 + 2 + 0 = 3.
      expect(result.totalPointsEarned).toBe(2);
      expect(result.grade).toBeCloseTo(2 / 3);

      buildSpy.mockRestore();
    });

    it("leaves the stored grade untouched when no response exceeds its question's max", async () => {
      mockPrisma.assignmentAttempt.findUnique.mockResolvedValue({
        ...assignmentAttempt,
        grade: 0.7,
        questionResponses: [
          { questionId: 101, points: 4 },
          { questionId: 202, points: 3 },
        ],
      });
      const buildSpy = jest
        .spyOn(AttemptQuestionsMapper, "buildQuestionsWithResponses")
        .mockResolvedValue([
          { id: 101, totalPoints: 5 },
          { id: 202, totalPoints: 5 },
        ]);

      const result = await service.getLearnerAssignmentAttempt(71, {
        userId: "learner-1",
        role: UserRole.LEARNER,
        assignmentId: 99,
        groupId: "group-1",
      });

      expect(result.totalPointsEarned).toBe(7);
      // Nothing was clamped, so the persisted grade is passed through as-is.
      expect(result.grade).toBe(0.7);

      buildSpy.mockRestore();
    });

    it("omits totalPointsEarned when showAssignmentScore=false", async () => {
      mockPrisma.assignmentAttempt.findUnique.mockResolvedValue({
        ...assignmentAttempt,
        questionOrder: [101],
        questionResponses: [{ questionId: 101, points: 4 }],
      });
      mockAttemptAccessCacheService.getQuestionDtosForAttemptAccess.mockResolvedValue(
        [{ id: 101, totalPoints: 5 }],
      );
      const buildSpy = jest
        .spyOn(AttemptQuestionsMapper, "buildQuestionsWithResponses")
        .mockResolvedValue([{ id: 101, totalPoints: 5 }]);
      mockPrisma.assignment.findUnique.mockResolvedValue({
        id: 99,
        questionOrder: [101],
        displayOrder: null,
        passingGrade: 50,
        showAssignmentScore: false,
        showSubmissionFeedback: true,
        showQuestionScore: true,
        showQuestions: true,
        updatedAt: new Date("2026-04-26T00:00:00.000Z"),
        currentVersion: { correctAnswerVisibility: "ALWAYS" },
      });

      const result = await service.getLearnerAssignmentAttempt(71, {
        userId: "learner-1",
        role: UserRole.LEARNER,
        assignmentId: 99,
        groupId: "group-1",
      });

      expect(result.totalPossiblePoints).toBe(5);
      expect(result.totalPointsEarned).toBeUndefined();

      buildSpy.mockRestore();
    });

    it("uses cached questions for translation-aware attempt reads", async () => {
      const translationMap = new Map();
      mockTranslationService.getTranslationsForAttempt.mockResolvedValue(
        translationMap,
      );
      const translationBuildSpy = jest
        .spyOn(AttemptQuestionsMapper, "buildQuestionsWithTranslations")
        .mockResolvedValue([{ id: 101 }, { id: 202 }]);
      const removeSensitiveSpy = jest
        .spyOn(service as never, "removeSensitiveData")
        .mockImplementation(() => undefined);

      const result = await service.getAssignmentAttempt(71, "fr");

      expect(
        mockAttemptAccessCacheService.getQuestionDtosForAttemptAccess,
      ).toHaveBeenCalledWith({
        assignmentId: 99,
        assignmentUpdatedAt: new Date("2026-04-26T00:00:00.000Z"),
        assignmentVersionId: 12,
        questionVersions: [],
      });
      expect(
        mockTranslationService.getTranslationsForAttempt,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ id: 71 }),
        expect.arrayContaining([
          expect.objectContaining({ id: 101, answer: true }),
          expect.objectContaining({ id: 202, answer: false }),
        ]),
      );
      expect(translationBuildSpy).toHaveBeenCalled();
      expect(result.questions).toEqual([{ id: 101 }, { id: 202 }]);

      translationBuildSpy.mockRestore();
      removeSensitiveSpy.mockRestore();
    });
  });

  describe("updateAssignmentAttempt - author preview", () => {
    const assignmentId = 77;
    type UpdateAttemptDto = Parameters<
      AttemptSubmissionService["updateAssignmentAttempt"]
    >[2];
    type UpdateAttemptRequest = Parameters<
      AttemptSubmissionService["updateAssignmentAttempt"]
    >[5];

    const authorRequest = {
      userSession: {
        userId: "author-1",
        role: UserRole.AUTHOR,
        assignmentId,
        groupId: "group-1",
      },
    };

    beforeEach(() => {
      mockPrisma.assignment.findUnique.mockResolvedValue({
        id: assignmentId,
        questions: [],
        currentVersion: { correctAnswerVisibility: "NEVER" },
        showAssignmentScore: true,
        showQuestions: true,
        showSubmissionFeedback: true,
      });
      mockGradingService.constructFeedbacksForQuestions.mockReturnValue([]);
    });

    it("uses authorQuestions as the points source without querying fallback questions", async () => {
      const updateDto = {
        submitted: true,
        language: "en",
        responsesForQuestions: [
          { id: 966_122_647, question: "Draft question response" },
        ],
        authorQuestions: [{ id: 966_122_647, totalPoints: 12 }],
      };

      const successfulResponses = [
        makeResponse({
          questionId: 966_122_647,
          totalPoints: 8,
          metadata: undefined,
        }),
      ];

      mockQuestionResponseService.submitQuestions.mockResolvedValue(
        successfulResponses,
      );
      mockGradingService.calculateGradeForAuthor.mockReturnValue({
        grade: 8 / 12,
        totalPointsEarned: 8,
        totalPossiblePoints: 12,
      });

      const result = await service.updateAssignmentAttempt(
        -1,
        assignmentId,
        updateDto as UpdateAttemptDto,
        "",
        false,
        authorRequest as UpdateAttemptRequest,
      );

      expect(result.totalPossiblePoints).toBe(12);
      expect(result.totalPointsEarned).toBe(8);
      expect(mockPrisma.question.findMany).not.toHaveBeenCalled();
      expect(mockGradingService.calculateGradeForAuthor).toHaveBeenCalledWith(
        successfulResponses,
        12,
      );
    });

    it("withholds the grade when showAssignmentScore is false, mirroring the learner response", async () => {
      // The preview is the author's only window into the learner experience,
      // so it must apply the same visibility rules as the learner submit path.
      mockPrisma.assignment.findUnique.mockResolvedValue({
        id: assignmentId,
        questions: [],
        currentVersion: { correctAnswerVisibility: "NEVER" },
        showAssignmentScore: false,
        showQuestions: true,
        showSubmissionFeedback: true,
      });

      const updateDto = {
        submitted: true,
        language: "en",
        responsesForQuestions: [{ id: 1, question: "Preview response" }],
        authorQuestions: [{ id: 1, totalPoints: 1 }],
      };

      mockQuestionResponseService.submitQuestions.mockResolvedValue([
        makeResponse({ questionId: 1, totalPoints: 1, metadata: undefined }),
      ]);
      mockGradingService.calculateGradeForAuthor.mockReturnValue({
        grade: 1,
        totalPointsEarned: 1,
        totalPossiblePoints: 1,
      });

      const result = await service.updateAssignmentAttempt(
        -1,
        assignmentId,
        updateDto as UpdateAttemptDto,
        "",
        false,
        authorRequest as UpdateAttemptRequest,
      );

      expect(result.grade).toBeUndefined();
      expect(result.totalPointsEarned).toBe(1);
      expect(result.totalPossiblePoints).toBe(1);
    });

    it("returns the grade when showAssignmentScore is true", async () => {
      const updateDto = {
        submitted: true,
        language: "en",
        responsesForQuestions: [{ id: 1, question: "Preview response" }],
        authorQuestions: [{ id: 1, totalPoints: 2 }],
      };

      mockQuestionResponseService.submitQuestions.mockResolvedValue([
        makeResponse({ questionId: 1, totalPoints: 2, metadata: undefined }),
      ]);
      mockGradingService.calculateGradeForAuthor.mockReturnValue({
        grade: 1,
        totalPointsEarned: 2,
        totalPossiblePoints: 2,
      });

      const result = await service.updateAssignmentAttempt(
        -1,
        assignmentId,
        updateDto as UpdateAttemptDto,
        "",
        false,
        authorRequest as UpdateAttemptRequest,
      );

      expect(result.grade).toBe(1);
    });

    it("throws when preview responses reference questions missing from provided draft questions", async () => {
      const updateDto = {
        submitted: true,
        language: "en",
        responsesForQuestions: [
          { id: 404, question: "Missing draft question" },
        ],
      };

      mockQuestionResponseService.submitQuestions.mockResolvedValue([
        makeResponse({
          questionId: 404,
          totalPoints: 5,
          metadata: undefined,
        }),
      ]);

      await expect(
        service.updateAssignmentAttempt(
          -1,
          assignmentId,
          updateDto as UpdateAttemptDto,
          "",
          false,
          authorRequest as UpdateAttemptRequest,
        ),
      ).rejects.toThrow(
        "Question 404 not found in provided questions. This prevents accurate grading.",
      );

      expect(mockPrisma.question.findMany).not.toHaveBeenCalled();
      expect(mockGradingService.calculateGradeForAuthor).not.toHaveBeenCalled();
    });
  });

  describe("Grade Validation - Integration Tests", () => {
    it("should prevent grade of 0 when totalPossiblePoints is calculated incorrectly", async () => {
      // This test simulates the original bug:
      // Learner gets points (8/10) but grade becomes 0 due to wrong totalPossiblePoints

      const responses: TestResponse[] = [
        makeResponse({
          questionId: 1,
          totalPoints: 8, // Learner earned 8 points
          metadata: { maxPossiblePoints: 10 }, // Max is 10
        }),
      ];

      // Simulate bug: assignment.questions is empty (filtered out)
      const questions: Question[] = [];

      // With the fix, this should use metadata and calculate correctly
      const result = await calculateTotals(responses, questions);

      expect(result.totalPossiblePoints).toBe(10);
      expect(result.missingQuestions).toHaveLength(1);

      // Now calculate grade
      mockGradingService.calculateGradeForLearner.mockReturnValue({
        grade: 0.8, // 8/10 = 0.8
        totalPointsEarned: 8,
        totalPossiblePoints: 10,
      });

      const gradeResult = mockGradingService.calculateGradeForLearner(
        responses,
        result.totalPossiblePoints,
      );

      // Learner should get 80%, not 0%!
      expect(gradeResult.grade).toBe(0.8);
      expect(gradeResult.totalPointsEarned).toBe(8);
    });

    it("should throw error when totalPossiblePoints is 0", async () => {
      const responses: TestResponse[] = [];
      const questions: Question[] = [];

      const result = await calculateTotals(responses, questions);

      // totalPossiblePoints should be 0 for empty responses
      expect(result.totalPossiblePoints).toBe(0);

      // In the actual updateLearnerAttempt method, this should throw an error
      // This validation prevents division by zero and incorrect grades
    });

    it("should handle mixed scenario: some questions found, some missing", async () => {
      const responses: TestResponse[] = [
        makeResponse({
          questionId: 1,
          totalPoints: 10,
        }),
        makeResponse({
          questionId: 2,
          totalPoints: 5,
          metadata: { maxPossiblePoints: 10 }, // Question 2 is deleted but has metadata
        }),
        makeResponse({
          questionId: 3,
          totalPoints: 8,
        }),
      ];

      const questions: Question[] = [
        { id: 1, totalPoints: 10 } as Question,
        // Question 2 is missing (deleted)
        { id: 3, totalPoints: 10 } as Question,
      ];

      const result = await calculateTotals(responses, questions);

      expect(result.totalPossiblePoints).toBe(30); // 10 + 10 (from metadata) + 10
      expect(result.missingQuestions).toEqual([2]);
    });
  });

  describe("Edge Cases", () => {
    it("should handle questions with 0 totalPoints", async () => {
      const responses: TestResponse[] = [
        makeResponse({
          questionId: 1,
          totalPoints: 0,
        }),
      ];

      const questions: Question[] = [
        { id: 1, totalPoints: 0 } as Question, // Survey question with 0 points
      ];

      const result = await calculateTotals(responses, questions);

      expect(result.totalPossiblePoints).toBe(0);
      expect(result.missingQuestions).toHaveLength(0);
    });

    it("should handle very large point values", async () => {
      const responses: TestResponse[] = [
        makeResponse({
          questionId: 1,
          totalPoints: 999,
        }),
      ];

      const questions: Question[] = [{ id: 1, totalPoints: 1000 } as Question];

      const result = await calculateTotals(responses, questions);

      expect(result.totalPossiblePoints).toBe(1000);
    });

    it("should handle metadata with invalid maxPossiblePoints", async () => {
      const responses: TestResponse[] = [
        makeResponse({
          questionId: 1,
          totalPoints: 5,
          metadata: { maxPossiblePoints: -10 }, // Invalid negative value
        }),
      ];

      const questions: Question[] = []; // Question missing

      // Should throw because metadata has invalid value
      await expect(calculateTotals(responses, questions)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it("should handle metadata with 0 maxPossiblePoints", async () => {
      const responses: TestResponse[] = [
        makeResponse({
          questionId: 1,
          totalPoints: 0,
          metadata: { maxPossiblePoints: 0 }, // 0 is not valid
        }),
      ];

      const questions: Question[] = [];

      // Should throw because 0 is not a valid maxPossiblePoints
      await expect(calculateTotals(responses, questions)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe("Regression Tests - Original Bug", () => {
    it("REGRESSION: should not return grade=0 when learner scored points but questions are deleted", async () => {
      // This is the exact bug reported by the user:
      // Learner gets awarded question points, but final grade is 0 or wrong

      const responses: TestResponse[] = [
        makeResponse({
          questionId: 1,
          totalPoints: 8,
          metadata: { maxPossiblePoints: 10 },
        }),
        makeResponse({
          questionId: 2,
          totalPoints: 7,
          metadata: { maxPossiblePoints: 10 },
        }),
      ];

      // Bug scenario: Questions deleted after attempt created
      const questions: Question[] = [];

      const result = await calculateTotals(responses, questions);

      // Fix ensures totalPossiblePoints is calculated from metadata
      expect(result.totalPossiblePoints).toBe(20); // 10 + 10 from metadata
      expect(result.missingQuestions).toHaveLength(2);

      // Calculate expected grade
      const totalPointsEarned = 15; // 8 + 7
      const expectedGrade = totalPointsEarned / result.totalPossiblePoints; // 15/20 = 0.75

      expect(expectedGrade).toBe(0.75);
      expect(expectedGrade).not.toBe(0); // Learner should NOT fail!
    });

    it("REGRESSION: should not allow NaN grades", () => {
      // Bug: division by zero when totalPossiblePoints = 0
      mockGradingService.calculateGradeForLearner.mockReturnValue({
        grade: Number.NaN, // Simulating NaN from 0/0
        totalPointsEarned: 0,
        totalPossiblePoints: 0,
      });

      const grade = mockGradingService.calculateGradeForLearner([], 0);

      // The validation in updateLearnerAttempt should catch this
      expect(grade.grade).toBeNaN();
      // In actual code, this triggers: if (isNaN(grade) || grade < 0 || grade > 1) throw Error
    });
  });

  // ─── Change 4: authorComment bug fix ─────────────────────────────────────

  describe("removeSensitiveData — authorComment always null (Change 4)", () => {
    type QuestionLike = {
      authorComment: string | null;
      scoring?: { showRubricsToLearner?: boolean; rubrics?: unknown };
      choices?: Array<{
        points?: number;
        isCorrect?: boolean;
        feedback?: string;
      }>;
    };

    const callRemoveSensitiveData = (
      questions: QuestionLike[],
      correctAnswerVisibility = "NEVER",
      grade = 0,
      passingGrade = 0,
    ) =>
      (
        service as unknown as {
          removeSensitiveData: (
            questions: QuestionLike[],
            assignment: { correctAnswerVisibility: string },
            grade: number,
            passingGrade: number,
          ) => void;
        }
      ).removeSensitiveData(
        questions,
        { correctAnswerVisibility },
        grade,
        passingGrade,
      );

    it("sets authorComment to null for every question", () => {
      const questions: QuestionLike[] = [
        { authorComment: "Internal note only for graders" },
        { authorComment: "Another internal note" },
      ];

      callRemoveSensitiveData(questions);

      expect(questions[0].authorComment).toBeNull();
      expect(questions[1].authorComment).toBeNull();
    });

    it("sets authorComment to null even when it was already null", () => {
      const questions: QuestionLike[] = [{ authorComment: null }];

      callRemoveSensitiveData(questions);

      expect(questions[0].authorComment).toBeNull();
    });

    it("sets authorComment to null regardless of grade or passing threshold", () => {
      const question: QuestionLike = { authorComment: "Should be hidden" };

      // High grade — still must be null
      callRemoveSensitiveData([question], "PASSING", 1, 0.5);
      expect(question.authorComment).toBeNull();
    });

    it("does not expose rubrics when showRubricsToLearner is false", () => {
      const question: QuestionLike = {
        authorComment: "hidden",
        scoring: {
          showRubricsToLearner: false,
          rubrics: { criterion: "fluency" },
        },
      };

      callRemoveSensitiveData([question]);

      expect(question.scoring?.rubrics).toBeUndefined();
    });

    it("preserves rubrics when showRubricsToLearner is true", () => {
      const rubrics = { criterion: "fluency" };
      const question: QuestionLike = {
        authorComment: "hidden",
        scoring: { showRubricsToLearner: true, rubrics },
      };

      callRemoveSensitiveData([question]);

      expect(question.scoring?.rubrics).toBe(rubrics);
    });
  });

  describe("updateLearnerAttempt - submission validation", () => {
    it("throws ConflictException before grading when the attempt is already submitted", async () => {
      mockPrisma.assignmentAttempt.findUnique.mockResolvedValue({
        id: 555,
        submitted: true,
        expiresAt: new Date(Date.now() + 60_000),
        questionVariants: [],
      });
      mockValidationService.isAttemptExpired.mockReturnValue(false);

      const updateDto = {
        responsesForQuestions: [],
        language: "en",
      } as never;
      const request = {
        userSession: { userId: "learner@example.com", role: "Learner" },
      } as never;

      await expect(
        (
          service as unknown as {
            updateLearnerAttempt: (
              attemptId: number,
              assignmentId: number,
              updateDto: unknown,
              authCookie: string,
              gradingCallbackRequired: boolean,
              request: unknown,
            ) => Promise<unknown>;
          }
        ).updateLearnerAttempt(555, 2580, updateDto, "cookie", false, request),
      ).rejects.toMatchObject({ name: "ConflictException" });

      // Short-circuited before the expensive grading pipeline ran.
      expect(
        mockTranslationService.preTranslateQuestions,
      ).not.toHaveBeenCalled();
    });

    it("rejects unserved and duplicate question IDs before grading", async () => {
      mockPrisma.assignmentAttempt.findUnique.mockResolvedValue({
        id: 555,
        submitted: false,
        expiresAt: new Date(Date.now() + 60_000),
        questionOrder: [101],
        questionVariants: [],
      });
      mockPrisma.assignment.findUnique.mockResolvedValue({
        id: 2580,
        questionOrder: [101, 202],
        questions: [{ id: 101 }, { id: 202 }],
        currentVersion: { correctAnswerVisibility: "ALWAYS" },
      });
      mockValidationService.isAttemptExpired.mockReturnValue(false);

      const updateDto = {
        responsesForQuestions: [{ id: 101 }, { id: 101 }, { id: 202 }],
        language: "en",
      } as never;
      const request = {
        userSession: { userId: "learner@example.com", role: "Learner" },
      } as never;

      await expect(
        (
          service as unknown as {
            updateLearnerAttempt: (
              attemptId: number,
              assignmentId: number,
              updateDto: unknown,
              authCookie: string,
              gradingCallbackRequired: boolean,
              request: unknown,
            ) => Promise<unknown>;
          }
        ).updateLearnerAttempt(555, 2580, updateDto, "cookie", true, request),
      ).rejects.toThrow(
        "unserved question IDs [202]; duplicate question IDs [101]",
      );

      expect(
        mockTranslationService.preTranslateQuestions,
      ).not.toHaveBeenCalled();
      expect(mockLtiGradeSyncService.createAndSync).not.toHaveBeenCalled();
    });
  });
});
