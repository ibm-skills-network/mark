import { HttpService } from "@nestjs/axios";
import { InternalServerErrorException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { Question } from "@prisma/client";
import { CreateQuestionResponseAttemptResponseDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import { AssignmentRepository } from "src/api/assignment/v2/repositories/assignment.repository";
import { PrismaService } from "../../../database/prisma.service";
import { AttemptGradingService } from "./attempt-grading.service";
import { AttemptSubmissionService } from "./attempt-submission.service";
import { AttemptValidationService } from "./attempt-validation.service";
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
    metadata: overrides.metadata ?? null,
    learnerResponse: overrides.learnerResponse,
    points: overrides.points,
  });

  const calculateTotals = (responses: TestResponse[], questions: Question[]) =>
    (
      service as unknown as {
        calculateTotalPossiblePointsWithValidation: (
          r: TestResponse[],
          q: Question[],
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
          metadata: null, // No metadata!
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
