/* eslint-disable */
import { NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import {
  AssignmentQuestionDisplayOrder,
  AssignmentType,
  CorrectAnswerVisibility,
  QuestionDisplay,
  QuestionType,
  ResponseType,
} from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";
import { LLM_PRICING_SERVICE } from "../../llm/llm.constants";
import { AdminService } from "../admin.service";
import { AdminAddContentToAssignmentRequestDto } from "../dto/assignment/add.content.to.assignment.request.dto";

describe("AdminService - addContentToAssignment", () => {
  let service: AdminService;
  let prismaService: PrismaService;

  // Mock data
  const mockAssignmentId = 1;
  const mockUserId = "test-user-123";

  const mockExistingAssignment = {
    id: mockAssignmentId,
    name: "Empty Assignment",
    type: AssignmentType.AI_GRADED,
    published: false,
    _count: { questions: 0 },
  };

  const mockContentDto: AdminAddContentToAssignmentRequestDto = {
    assignment: {
      name: "Cybersecurity Career Assignment",
      introduction:
        "<p>In this project, you will explore a Cybersecurity job listing.</p>",
      instructions: "<p>Complete the following tasks:</p>",
      learningObjectives: "Understanding cybersecurity careers",
    },
    config: {
      numAttempts: -1,
      attemptsBeforeCoolDown: 1,
      retakeAttemptCoolDownMinutes: 5,
      passingGrade: 60,
      displayOrder: AssignmentQuestionDisplayOrder.RANDOM,
      graded: true,
      questionVariationNumber: 0,
      questionDisplay: QuestionDisplay.ONE_PER_PAGE,
      showQuestions: true,
      showSubmissionFeedback: true,
      showAssignmentScore: true,
      numberOfQuestionsPerAttempt: null,
      timeEstimateMinutes: null,
      allotedTimeMinutes: null,
      attemptsPerTimeRange: null,
      attemptsTimeRangeHours: null,
      showQuestionScore: true,
      correctAnswerVisibility: CorrectAnswerVisibility.ON_PASS,
      currentVersion: null,
      versions: [],
    },
    feedbackConfig: {
      verbosityLevel: "Full",
      showSubmissionFeedback: true,
      showQuestionScore: true,
      showAssignmentScore: true,
      showQuestions: true,
    },
    gradingCriteria:
      "<p>The assignment is worth 10 points and requires 60% to pass.</p>",
    questions: [
      {
        type: QuestionType.SINGLE_CORRECT,
        question: "What is IBM Cloud VCFaaS?",
        responseType: ResponseType.OTHER,
        maxWords: null,
        maxCharacters: null,
        totalPoints: 1,
        randomizedChoices: true,
        choices: [
          {
            choice: "A fully managed SDDC platform",
            id: 0,
            isCorrect: true,
            points: 1,
            feedback: "Correct!",
          },
          {
            choice: "A self-service platform",
            id: 1,
            isCorrect: false,
            points: 0,
            feedback: "Incorrect",
          },
        ],
      },
      {
        type: QuestionType.TEXT,
        question: "Describe your career goals",
        responseType: ResponseType.OTHER,
        maxWords: 500,
        maxCharacters: null,
        totalPoints: 5,
        randomizedChoices: null,
        scoring: {
          type: "CRITERIA_BASED",
          rubrics: [
            {
              rubricQuestion: "Clarity of goals",
              criteria: [
                {
                  id: 1,
                  description: "Goals are clear and well-defined",
                  points: 3,
                },
                {
                  id: 2,
                  description: "Goals are somewhat clear",
                  points: 1,
                },
              ],
            },
          ],
          showSubQuestionsToLearner: false,
          showPoints: false,
          showRubricsToLearner: false,
        },
      },
    ],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        {
          provide: PrismaService,
          useValue: {
            assignment: {
              findUnique: jest.fn(),
              update: jest.fn(),
            },
            question: {
              createMany: jest.fn(),
              findMany: jest.fn(),
            },
            assignmentVersion: {
              create: jest.fn(),
            },
            questionVersion: {
              createMany: jest.fn(),
            },
            $transaction: jest.fn(),
          },
        },
        {
          provide: LLM_PRICING_SERVICE,
          useValue: {
            calculateCostWithBreakdown: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  describe("Successful scenarios", () => {
    it("should successfully add content to an empty assignment", async () => {
      // Arrange
      const mockCreatedQuestions = [
        {
          id: 1,
          assignmentId: mockAssignmentId,
          type: QuestionType.SINGLE_CORRECT,
          question: "What is IBM Cloud VCFaaS?",
          responseType: ResponseType.OTHER,
          totalPoints: 1,
          choices: mockContentDto.questions[0].choices,
          scoring: null,
          maxWords: null,
          maxCharacters: null,
          randomizedChoices: true,
          answer: null,
          gradingContextQuestionIds: [],
          videoPresentationConfig: null,
          liveRecordingConfig: null,
        },
        {
          id: 2,
          assignmentId: mockAssignmentId,
          type: QuestionType.TEXT,
          question: "Describe your career goals",
          responseType: ResponseType.OTHER,
          totalPoints: 5,
          choices: null,
          scoring: mockContentDto.questions[1].scoring,
          maxWords: 500,
          maxCharacters: null,
          randomizedChoices: null,
          answer: null,
          gradingContextQuestionIds: [],
          videoPresentationConfig: null,
          liveRecordingConfig: null,
        },
      ];

      const mockUpdatedAssignment = {
        ...mockExistingAssignment,
        ...mockContentDto.assignment,
        published: true,
      };

      const mockAssignmentVersion = {
        id: 1,
        assignmentId: mockAssignmentId,
        versionNumber: "0.0.1",
        name: mockContentDto.assignment.name,
        isActive: true,
        isDraft: false,
        published: true,
      };

      // Mock the transaction
      (prismaService.$transaction as jest.Mock).mockImplementation(
        async (callback) => {
          const tx = {
            assignment: {
              findUnique: jest.fn().mockResolvedValue({
                ...mockExistingAssignment,
                _count: { questions: 0 },
              }),
              update: jest
                .fn()
                .mockResolvedValueOnce(mockUpdatedAssignment) // First update
                .mockResolvedValueOnce({
                  ...mockUpdatedAssignment,
                  currentVersionId: 1,
                }), // Second update
            },
            question: {
              createMany: jest.fn().mockResolvedValue({ count: 2 }),
              findMany: jest.fn().mockResolvedValue(mockCreatedQuestions),
            },
            assignmentVersion: {
              create: jest.fn().mockResolvedValue(mockAssignmentVersion),
            },
            questionVersion: {
              createMany: jest.fn().mockResolvedValue({ count: 2 }),
            },
          };

          return await callback(tx);
        },
      );

      // Act
      const result = await service.addContentToAssignment(
        mockAssignmentId,
        mockContentDto,
        mockUserId,
      );

      // Assert
      expect(result).toEqual({
        id: mockAssignmentId,
        success: true,
        name: mockContentDto.assignment.name,
        type: mockExistingAssignment.type,
      });

      // Verify transaction was called
      expect(prismaService.$transaction).toHaveBeenCalled();
    });

    it("should create version 0.0.1 with correct data", async () => {
      // Arrange
      const mockAssignmentVersion = {
        id: 1,
        assignmentId: mockAssignmentId,
        versionNumber: "0.0.1",
        name: mockContentDto.assignment.name,
        isActive: true,
        isDraft: false,
        published: true,
        createdBy: mockUserId,
        versionDescription: "Initial version created via API",
      };

      let capturedVersionData: any;

      (prismaService.$transaction as jest.Mock).mockImplementation(
        async (callback) => {
          const tx = {
            assignment: {
              findUnique: jest.fn().mockResolvedValue({
                ...mockExistingAssignment,
                _count: { questions: 0 },
              }),
              update: jest
                .fn()
                .mockResolvedValueOnce({
                  ...mockExistingAssignment,
                  published: true,
                })
                .mockResolvedValueOnce({
                  ...mockExistingAssignment,
                  currentVersionId: 1,
                }),
            },
            question: {
              createMany: jest.fn().mockResolvedValue({ count: 2 }),
              findMany: jest.fn().mockResolvedValue([]),
            },
            assignmentVersion: {
              create: jest.fn().mockImplementation((args) => {
                capturedVersionData = args.data;
                return Promise.resolve(mockAssignmentVersion);
              }),
            },
            questionVersion: {
              createMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
          };

          return await callback(tx);
        },
      );

      // Act
      await service.addContentToAssignment(
        mockAssignmentId,
        mockContentDto,
        mockUserId,
      );

      // Assert
      expect(capturedVersionData).toBeDefined();
      expect(capturedVersionData.versionNumber).toBe("0.0.1");
      expect(capturedVersionData.createdBy).toBe(mockUserId);
      expect(capturedVersionData.isActive).toBe(true);
      expect(capturedVersionData.isDraft).toBe(false);
      expect(capturedVersionData.published).toBe(true);
      expect(capturedVersionData.versionDescription).toBe(
        "Initial version created via API",
      );
    });

    it("should create question versions for all questions", async () => {
      // Arrange
      const mockCreatedQuestions = [
        {
          id: 1,
          totalPoints: 1,
          type: QuestionType.SINGLE_CORRECT,
          question: "Q1",
        },
        { id: 2, totalPoints: 5, type: QuestionType.TEXT, question: "Q2" },
      ];

      let capturedQuestionVersionsData: any;

      (prismaService.$transaction as jest.Mock).mockImplementation(
        async (callback) => {
          const tx = {
            assignment: {
              findUnique: jest.fn().mockResolvedValue({
                ...mockExistingAssignment,
                _count: { questions: 0 },
              }),
              update: jest
                .fn()
                .mockResolvedValueOnce({ ...mockExistingAssignment })
                .mockResolvedValueOnce({ ...mockExistingAssignment }),
            },
            question: {
              createMany: jest.fn().mockResolvedValue({ count: 2 }),
              findMany: jest.fn().mockResolvedValue(mockCreatedQuestions),
            },
            assignmentVersion: {
              create: jest
                .fn()
                .mockResolvedValue({ id: 1, versionNumber: "0.0.1" }),
            },
            questionVersion: {
              createMany: jest.fn().mockImplementation((args) => {
                capturedQuestionVersionsData = args.data;
                return Promise.resolve({ count: 2 });
              }),
            },
          };

          return await callback(tx);
        },
      );

      // Act
      await service.addContentToAssignment(
        mockAssignmentId,
        mockContentDto,
        mockUserId,
      );

      // Assert
      expect(capturedQuestionVersionsData).toBeDefined();
      expect(capturedQuestionVersionsData).toHaveLength(2);
      expect(capturedQuestionVersionsData[0].assignmentVersionId).toBe(1);
      expect(capturedQuestionVersionsData[0].questionId).toBe(1);
      expect(capturedQuestionVersionsData[0].displayOrder).toBe(0);
      expect(capturedQuestionVersionsData[1].displayOrder).toBe(1);
    });

    it("should set currentVersionId on the assignment", async () => {
      // Arrange
      let secondUpdateCalled = false;
      let capturedVersionId: any;

      (prismaService.$transaction as jest.Mock).mockImplementation(
        async (callback) => {
          const tx = {
            assignment: {
              findUnique: jest.fn().mockResolvedValue({
                ...mockExistingAssignment,
                _count: { questions: 0 },
              }),
              update: jest
                .fn()
                .mockResolvedValueOnce({ ...mockExistingAssignment })
                .mockImplementationOnce((args) => {
                  secondUpdateCalled = true;
                  capturedVersionId = args.data.currentVersionId;
                  return Promise.resolve({
                    ...mockExistingAssignment,
                    currentVersionId: args.data.currentVersionId,
                  });
                }),
            },
            question: {
              createMany: jest.fn().mockResolvedValue({ count: 0 }),
              findMany: jest.fn().mockResolvedValue([]),
            },
            assignmentVersion: {
              create: jest
                .fn()
                .mockResolvedValue({ id: 99, versionNumber: "0.0.1" }),
            },
            questionVersion: {
              createMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
          };

          return await callback(tx);
        },
      );

      // Act
      await service.addContentToAssignment(
        mockAssignmentId,
        mockContentDto,
        mockUserId,
      );

      // Assert
      expect(secondUpdateCalled).toBe(true);
      expect(capturedVersionId).toBe(99);
    });

    it("should handle assignment with no questions", async () => {
      // Arrange
      const dtoWithNoQuestions = {
        ...mockContentDto,
        questions: [],
      };

      (prismaService.$transaction as jest.Mock).mockImplementation(
        async (callback) => {
          const tx = {
            assignment: {
              findUnique: jest.fn().mockResolvedValue({
                ...mockExistingAssignment,
                _count: { questions: 0 },
              }),
              update: jest
                .fn()
                .mockResolvedValueOnce({ ...mockExistingAssignment })
                .mockResolvedValueOnce({ ...mockExistingAssignment }),
            },
            question: {
              createMany: jest.fn(),
              findMany: jest.fn().mockResolvedValue([]),
            },
            assignmentVersion: {
              create: jest
                .fn()
                .mockResolvedValue({ id: 1, versionNumber: "0.0.1" }),
            },
            questionVersion: {
              createMany: jest.fn(),
            },
          };

          return await callback(tx);
        },
      );

      // Act
      const result = await service.addContentToAssignment(
        mockAssignmentId,
        dtoWithNoQuestions,
        mockUserId,
      );

      // Assert
      expect(result.success).toBe(true);
    });
  });

  describe("Error scenarios", () => {
    it("should throw NotFoundException when assignment does not exist", async () => {
      // Arrange
      (prismaService.$transaction as jest.Mock).mockImplementation(
        async (callback) => {
          const tx = {
            assignment: {
              findUnique: jest.fn().mockResolvedValue(null),
            },
          };

          return await callback(tx);
        },
      );

      // Act & Assert
      await expect(
        service.addContentToAssignment(
          mockAssignmentId,
          mockContentDto,
          mockUserId,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("should rollback all changes if version creation fails", async () => {
      // Arrange
      (prismaService.$transaction as jest.Mock).mockRejectedValue(
        new Error("Version creation failed"),
      );

      // Act & Assert
      await expect(
        service.addContentToAssignment(
          mockAssignmentId,
          mockContentDto,
          mockUserId,
        ),
      ).rejects.toThrow("Version creation failed");
    });

    it("should rollback all changes if question creation fails", async () => {
      // Arrange
      (prismaService.$transaction as jest.Mock).mockImplementation(
        async (callback) => {
          const tx = {
            assignment: {
              findUnique: jest.fn().mockResolvedValue({
                ...mockExistingAssignment,
                _count: { questions: 0 },
              }),
              update: jest
                .fn()
                .mockResolvedValue({ ...mockExistingAssignment }),
            },
            question: {
              createMany: jest
                .fn()
                .mockRejectedValue(new Error("Question creation failed")),
            },
          };

          return await callback(tx);
        },
      );

      // Act & Assert
      await expect(
        service.addContentToAssignment(
          mockAssignmentId,
          mockContentDto,
          mockUserId,
        ),
      ).rejects.toThrow("Question creation failed");
    });

    it("should rollback if question version creation fails", async () => {
      // Arrange
      (prismaService.$transaction as jest.Mock).mockImplementation(
        async (callback) => {
          const tx = {
            assignment: {
              findUnique: jest.fn().mockResolvedValue({
                ...mockExistingAssignment,
                _count: { questions: 0 },
              }),
              update: jest
                .fn()
                .mockResolvedValue({ ...mockExistingAssignment }),
            },
            question: {
              createMany: jest.fn().mockResolvedValue({ count: 2 }),
              findMany: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
            },
            assignmentVersion: {
              create: jest
                .fn()
                .mockResolvedValue({ id: 1, versionNumber: "0.0.1" }),
            },
            questionVersion: {
              createMany: jest
                .fn()
                .mockRejectedValue(
                  new Error("Question version creation failed"),
                ),
            },
          };

          return await callback(tx);
        },
      );

      // Act & Assert
      await expect(
        service.addContentToAssignment(
          mockAssignmentId,
          mockContentDto,
          mockUserId,
        ),
      ).rejects.toThrow("Question version creation failed");
    });
  });

  describe("Edge cases", () => {
    it("should warn when adding content to assignment that already has questions", async () => {
      // Arrange
      const assignmentWithQuestions = {
        ...mockExistingAssignment,
        _count: { questions: 5 },
      };

      const warnSpy = jest.spyOn(service["logger"], "warn");

      (prismaService.$transaction as jest.Mock).mockImplementation(
        async (callback) => {
          const tx = {
            assignment: {
              findUnique: jest.fn().mockResolvedValue(assignmentWithQuestions),
              update: jest
                .fn()
                .mockResolvedValueOnce({ ...mockExistingAssignment })
                .mockResolvedValueOnce({ ...mockExistingAssignment }),
            },
            question: {
              createMany: jest.fn().mockResolvedValue({ count: 2 }),
              findMany: jest.fn().mockResolvedValue([]),
            },
            assignmentVersion: {
              create: jest
                .fn()
                .mockResolvedValue({ id: 1, versionNumber: "0.0.1" }),
            },
            questionVersion: {
              createMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
          };

          return await callback(tx);
        },
      );

      // Act
      await service.addContentToAssignment(
        mockAssignmentId,
        mockContentDto,
        mockUserId,
      );

      // Assert
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("already has 5 questions"),
      );
    });

    it("should use default userId when not provided", async () => {
      // Arrange
      let capturedUserId: any;

      (prismaService.$transaction as jest.Mock).mockImplementation(
        async (callback) => {
          const tx = {
            assignment: {
              findUnique: jest.fn().mockResolvedValue({
                ...mockExistingAssignment,
                _count: { questions: 0 },
              }),
              update: jest
                .fn()
                .mockResolvedValueOnce({ ...mockExistingAssignment })
                .mockResolvedValueOnce({ ...mockExistingAssignment }),
            },
            question: {
              createMany: jest.fn().mockResolvedValue({ count: 0 }),
              findMany: jest.fn().mockResolvedValue([]),
            },
            assignmentVersion: {
              create: jest.fn().mockImplementation((args) => {
                capturedUserId = args.data.createdBy;
                return Promise.resolve({ id: 1, versionNumber: "0.0.1" });
              }),
            },
            questionVersion: {
              createMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
          };

          return await callback(tx);
        },
      );

      // Act
      await service.addContentToAssignment(mockAssignmentId, mockContentDto);

      // Assert
      expect(capturedUserId).toBe("system");
    });

    it("should handle questions with null/undefined optional fields", async () => {
      // Arrange
      const dtoWithNullFields = {
        ...mockContentDto,
        questions: [
          {
            type: QuestionType.TEXT,
            question: "Test question",
            responseType: ResponseType.OTHER,
            maxWords: null,
            maxCharacters: null,
            totalPoints: 1,
            randomizedChoices: null,
            scoring: undefined,
          },
        ],
      };

      (prismaService.$transaction as jest.Mock).mockImplementation(
        async (callback) => {
          const tx = {
            assignment: {
              findUnique: jest.fn().mockResolvedValue({
                ...mockExistingAssignment,
                _count: { questions: 0 },
              }),
              update: jest
                .fn()
                .mockResolvedValueOnce({ ...mockExistingAssignment })
                .mockResolvedValueOnce({ ...mockExistingAssignment }),
            },
            question: {
              createMany: jest.fn().mockResolvedValue({ count: 1 }),
              findMany: jest.fn().mockResolvedValue([
                {
                  id: 1,
                  maxWords: null,
                  maxCharacters: null,
                  scoring: null,
                  choices: null,
                },
              ]),
            },
            assignmentVersion: {
              create: jest
                .fn()
                .mockResolvedValue({ id: 1, versionNumber: "0.0.1" }),
            },
            questionVersion: {
              createMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
          };

          return await callback(tx);
        },
      );

      // Act & Assert
      await expect(
        service.addContentToAssignment(
          mockAssignmentId,
          dtoWithNullFields,
          mockUserId,
        ),
      ).resolves.not.toThrow();
    });

    it("should handle large number of questions (bulk insert)", async () => {
      // Arrange
      const manyQuestions = Array.from({ length: 100 }, (_, i) => ({
        type: QuestionType.TEXT,
        question: `Question ${i}`,
        responseType: ResponseType.OTHER,
        maxWords: null,
        maxCharacters: null,
        totalPoints: 1,
        randomizedChoices: null,
      }));

      const dtoWithManyQuestions = {
        ...mockContentDto,
        questions: manyQuestions,
      };

      const mockCreatedQuestions = manyQuestions.map((_, i) => ({ id: i + 1 }));

      (prismaService.$transaction as jest.Mock).mockImplementation(
        async (callback) => {
          const tx = {
            assignment: {
              findUnique: jest.fn().mockResolvedValue({
                ...mockExistingAssignment,
                _count: { questions: 0 },
              }),
              update: jest
                .fn()
                .mockResolvedValueOnce({ ...mockExistingAssignment })
                .mockResolvedValueOnce({ ...mockExistingAssignment }),
            },
            question: {
              createMany: jest.fn().mockResolvedValue({ count: 100 }),
              findMany: jest.fn().mockResolvedValue(mockCreatedQuestions),
            },
            assignmentVersion: {
              create: jest
                .fn()
                .mockResolvedValue({ id: 1, versionNumber: "0.0.1" }),
            },
            questionVersion: {
              createMany: jest.fn().mockResolvedValue({ count: 100 }),
            },
          };

          return await callback(tx);
        },
      );

      // Act
      const result = await service.addContentToAssignment(
        mockAssignmentId,
        dtoWithManyQuestions,
        mockUserId,
      );

      // Assert
      expect(result.success).toBe(true);
    });
  });
});
