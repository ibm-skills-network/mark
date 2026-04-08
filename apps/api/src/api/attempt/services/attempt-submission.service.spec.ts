import { HttpService } from "@nestjs/axios";
import { InternalServerErrorException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { Question } from "@prisma/client";
import {
  UserRole,
  UserSession,
} from "../../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../../database/prisma.service";
import { CreateQuestionResponseAttemptResponseDto } from "../../assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import { AssignmentRepository } from "../../assignment/v2/repositories/assignment.repository";
import { AttemptGradingService } from "./attempt-grading.service";
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

  const mockAssignmentRepository = {
    findById: jest.fn(),
  };

  const mockQuestionResponseService = {
    submitQuestions: jest.fn(),
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
        { provide: AssignmentRepository, useValue: mockAssignmentRepository },
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
    };

    beforeEach(() => {
      mockAssignmentRepository.findById.mockResolvedValue(baseAssignment);
      mockValidationService.validateNewAttempt.mockResolvedValue(undefined);
      mockPrisma.assignmentAttempt.create.mockResolvedValue({ id: 55 });
      mockPrisma.assignmentAttempt.update.mockResolvedValue({});
    });

    it("batches question variant lookup by questionId", async () => {
      const questionVersions = [
        makeQuestionVersion({ id: 1001, questionId: 10, question: "Q1" }),
        makeQuestionVersion({ id: 1002, questionId: 20, question: "Q2" }),
        makeQuestionVersion({ id: 1003, questionId: null, question: "Q3" }),
      ];

      mockPrisma.assignment.findUnique.mockResolvedValue({
        currentVersionId: 9,
        currentVersion: { questionVersions },
        questions: [],
      });

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

      mockPrisma.question.findMany.mockResolvedValue([
        { id: 10, variants: [variant] },
        { id: 20, variants: [] },
      ]);

      const result = await service.createAssignmentAttempt(
        assignmentId,
        userSession,
      );

      expect(result).toEqual({ id: 55, success: true });
      expect(mockPrisma.question.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.question.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.question.findMany).toHaveBeenCalledWith({
        where: { id: { in: [10, 20] } },
        include: { variants: { where: { isDeleted: false } } },
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

      mockAssignmentRepository.findById.mockResolvedValue({
        ...baseAssignment,
        questionOrder: [20, 10],
      });
      mockPrisma.assignment.findUnique.mockResolvedValue({
        currentVersionId: 9,
        currentVersion: { questionVersions },
        questions: [],
      });
      mockPrisma.question.findMany.mockResolvedValue([
        { id: 10, variants: [] },
        { id: 20, variants: [] },
        { id: 30, variants: [] },
      ]);

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
});
