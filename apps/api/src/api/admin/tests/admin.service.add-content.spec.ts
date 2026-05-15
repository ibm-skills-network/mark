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
import { AssignmentServiceV2 } from "../../assignment/v2/services/assignment.service";
import { AssignmentFileService } from "../../assignment/v2/services/assignment-file.service";
import { JobStatusServiceV2 } from "../../assignment/v2/services/job-status.service";
import { QuestionService } from "../../assignment/v2/services/question.service";
import { LLM_PRICING_SERVICE } from "../../llm/llm.constants";
import { AdminService } from "../admin.service";
import { AdminAddContentToAssignmentRequestDto } from "../dto/assignment/add.content.to.assignment.request.dto";

describe("AdminService - addContentToAssignment", () => {
  let service: AdminService;
  let prismaService: PrismaService;
  let assignmentService: { publishAssignment: jest.Mock };

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

  const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

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
            $transaction: jest.fn(),
          },
        },
        {
          provide: AssignmentServiceV2,
          useValue: {
            publishAssignment: jest.fn().mockResolvedValue({
              jobId: 1,
              message: "Publishing started",
            }),
          },
        },
        {
          provide: AssignmentFileService,
          useValue: {
            cleanupAssignmentFileObjects: jest.fn(),
          },
        },
        {
          provide: QuestionService,
          useValue: {
            generateQuestions: jest.fn(),
          },
        },
        {
          provide: JobStatusServiceV2,
          useValue: {
            getJobStatus: jest.fn(),
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
    assignmentService = module.get(AssignmentServiceV2) as {
      publishAssignment: jest.Mock;
    };
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
        published: false,
      };
      const mockAssignmentForPublish = {
        ...mockUpdatedAssignment,
        gradingCriteriaOverview: mockContentDto.gradingCriteria,
        questionDisplay: mockContentDto.config.questionDisplay,
        displayOrder: mockContentDto.config.displayOrder,
        numAttempts: mockContentDto.config.numAttempts,
        attemptsBeforeCoolDown: mockContentDto.config.attemptsBeforeCoolDown,
        retakeAttemptCoolDownMinutes:
          mockContentDto.config.retakeAttemptCoolDownMinutes,
        passingGrade: mockContentDto.config.passingGrade,
        graded: mockContentDto.config.graded,
        showQuestions: mockContentDto.config.showQuestions,
        showSubmissionFeedback: mockContentDto.config.showSubmissionFeedback,
        showAssignmentScore: mockContentDto.config.showAssignmentScore,
        showQuestionScore: mockContentDto.config.showQuestionScore,
        correctAnswerVisibility: mockContentDto.config.correctAnswerVisibility,
        numberOfQuestionsPerAttempt:
          mockContentDto.config.numberOfQuestionsPerAttempt,
        timeEstimateMinutes: mockContentDto.config.timeEstimateMinutes,
        allotedTimeMinutes: mockContentDto.config.allotedTimeMinutes,
        attemptsPerTimeRange: mockContentDto.config.attemptsPerTimeRange,
        attemptsTimeRangeHours: mockContentDto.config.attemptsTimeRangeHours,
        questionOrder: [1, 2],
        updatedAt: new Date(),
        questions: mockCreatedQuestions.map((q) => ({
          ...q,
          variants: [],
        })),
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
          };

          return await callback(tx);
        },
      );
      (prismaService.assignment.findUnique as jest.Mock).mockResolvedValue(
        mockAssignmentForPublish,
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
      await flushPromises();
      expect(assignmentService.publishAssignment).toHaveBeenCalled();
    });

    it("should trigger publish after content import", async () => {
      // Arrange
      const mockAssignmentForPublish = {
        ...mockExistingAssignment,
        ...mockContentDto.assignment,
        gradingCriteriaOverview: mockContentDto.gradingCriteria,
        questionDisplay: mockContentDto.config.questionDisplay,
        displayOrder: mockContentDto.config.displayOrder,
        numAttempts: mockContentDto.config.numAttempts,
        attemptsBeforeCoolDown: mockContentDto.config.attemptsBeforeCoolDown,
        retakeAttemptCoolDownMinutes:
          mockContentDto.config.retakeAttemptCoolDownMinutes,
        passingGrade: mockContentDto.config.passingGrade,
        graded: mockContentDto.config.graded,
        showQuestions: mockContentDto.config.showQuestions,
        showSubmissionFeedback: mockContentDto.config.showSubmissionFeedback,
        showAssignmentScore: mockContentDto.config.showAssignmentScore,
        showQuestionScore: mockContentDto.config.showQuestionScore,
        correctAnswerVisibility: mockContentDto.config.correctAnswerVisibility,
        numberOfQuestionsPerAttempt:
          mockContentDto.config.numberOfQuestionsPerAttempt,
        timeEstimateMinutes: mockContentDto.config.timeEstimateMinutes,
        allotedTimeMinutes: mockContentDto.config.allotedTimeMinutes,
        attemptsPerTimeRange: mockContentDto.config.attemptsPerTimeRange,
        attemptsTimeRangeHours: mockContentDto.config.attemptsTimeRangeHours,
        questionOrder: [],
        updatedAt: new Date(),
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
                .mockResolvedValueOnce({
                  ...mockExistingAssignment,
                  published: false,
                })
                .mockResolvedValueOnce({
                  ...mockExistingAssignment,
                }),
            },
            question: {
              createMany: jest.fn().mockResolvedValue({ count: 2 }),
              findMany: jest.fn().mockResolvedValue([]),
            },
          };

          return await callback(tx);
        },
      );
      (prismaService.assignment.findUnique as jest.Mock).mockResolvedValue(
        mockAssignmentForPublish,
      );

      // Act
      await service.addContentToAssignment(
        mockAssignmentId,
        mockContentDto,
        mockUserId,
      );

      // Assert
      await flushPromises();
      expect(assignmentService.publishAssignment).toHaveBeenCalledWith(
        mockAssignmentId,
        expect.objectContaining({ published: true }),
        mockUserId,
      );
    });

    it("should persist question order based on created questions", async () => {
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

      let capturedQuestionOrder: number[] | undefined;

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
                  capturedQuestionOrder = args.data.questionOrder;
                  return Promise.resolve({ ...mockExistingAssignment });
                }),
            },
            question: {
              createMany: jest.fn().mockResolvedValue({ count: 2 }),
              findMany: jest.fn().mockResolvedValue(mockCreatedQuestions),
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
      expect(capturedQuestionOrder).toEqual([1, 2]);
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

    it("should not throw if publish fails", async () => {
      // Arrange
      (assignmentService.publishAssignment as jest.Mock).mockRejectedValueOnce(
        new Error("Publish failed"),
      );
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
      ).resolves.toBeDefined();
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
              findMany: jest.fn().mockResolvedValue([]),
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
      (prismaService.assignment.findUnique as jest.Mock).mockResolvedValue({
        ...mockExistingAssignment,
        questions: [],
        questionOrder: [],
        updatedAt: new Date(),
      });

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
          };

          return await callback(tx);
        },
      );

      // Act
      await service.addContentToAssignment(mockAssignmentId, mockContentDto);
      await flushPromises();

      // Assert
      expect(assignmentService.publishAssignment).toHaveBeenCalledWith(
        mockAssignmentId,
        expect.any(Object),
        "system",
      );
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
              findMany: jest.fn().mockResolvedValue([]),
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
              findMany: jest.fn().mockResolvedValue([]),
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

  describe("addContentToAssignment - publish payload integrity", () => {
    it("publish payload sent after createMany has alreadyInBackend: true on every QuestionDto", async () => {
      // Two persisted rows mirror the createMany'd output for the assignment.
      const persistedQuestions = [
        {
          id: 501,
          assignmentId: mockAssignmentId,
          isDeleted: false,
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
          authorComment: null,
          gradingContextQuestionIds: [],
          videoPresentationConfig: null,
          liveRecordingConfig: null,
          variants: [],
        },
        {
          id: 502,
          assignmentId: mockAssignmentId,
          isDeleted: false,
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
          authorComment: null,
          gradingContextQuestionIds: [],
          videoPresentationConfig: null,
          liveRecordingConfig: null,
          variants: [],
        },
      ];

      const mockUpdatedAssignment = {
        ...mockExistingAssignment,
        ...mockContentDto.assignment,
        questionOrder: [501, 502],
        updatedAt: new Date(),
      };

      const mockAssignmentForPublish = {
        ...mockUpdatedAssignment,
        gradingCriteriaOverview: mockContentDto.gradingCriteria,
        questionDisplay: mockContentDto.config.questionDisplay,
        displayOrder: mockContentDto.config.displayOrder,
        numAttempts: mockContentDto.config.numAttempts,
        attemptsBeforeCoolDown: mockContentDto.config.attemptsBeforeCoolDown,
        retakeAttemptCoolDownMinutes:
          mockContentDto.config.retakeAttemptCoolDownMinutes,
        passingGrade: mockContentDto.config.passingGrade,
        graded: mockContentDto.config.graded,
        showQuestions: mockContentDto.config.showQuestions,
        showSubmissionFeedback: mockContentDto.config.showSubmissionFeedback,
        showAssignmentScore: mockContentDto.config.showAssignmentScore,
        showQuestionScore: mockContentDto.config.showQuestionScore,
        correctAnswerVisibility: mockContentDto.config.correctAnswerVisibility,
        numberOfQuestionsPerAttempt:
          mockContentDto.config.numberOfQuestionsPerAttempt,
        timeEstimateMinutes: mockContentDto.config.timeEstimateMinutes,
        allotedTimeMinutes: mockContentDto.config.allotedTimeMinutes,
        attemptsPerTimeRange: mockContentDto.config.attemptsPerTimeRange,
        attemptsTimeRangeHours: mockContentDto.config.attemptsTimeRangeHours,
        questions: persistedQuestions,
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
                .mockResolvedValueOnce(mockUpdatedAssignment)
                .mockResolvedValueOnce(mockUpdatedAssignment),
            },
            question: {
              createMany: jest.fn().mockResolvedValue({ count: 2 }),
              findMany: jest.fn().mockResolvedValue(persistedQuestions),
            },
          };

          return callback(tx);
        },
      );
      (prismaService.assignment.findUnique as jest.Mock).mockResolvedValue(
        mockAssignmentForPublish,
      );

      // Act
      await service.addContentToAssignment(
        mockAssignmentId,
        mockContentDto,
        mockUserId,
      );
      await flushPromises();

      // Assert
      expect(assignmentService.publishAssignment).toHaveBeenCalledTimes(1);
      const [calledAssignmentId, payload, calledUserId] =
        assignmentService.publishAssignment.mock.calls[0];
      expect(calledAssignmentId).toBe(mockAssignmentId);
      expect(calledUserId).toBe(mockUserId);
      expect(payload.questions).toHaveLength(2);
      const ids = payload.questions.map((q: { id: number }) => q.id);
      expect(ids).toEqual([501, 502]);
      for (const q of payload.questions) {
        expect(q.alreadyInBackend).toBe(true);
      }
      expect(payload.questionOrder).toEqual([501, 502]);
    });

    it("in-transaction findMany filters isDeleted: false", async () => {
      let capturedFindManyArgs:
        | { where?: Record<string, unknown>; orderBy?: unknown }
        | undefined;

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
              findMany: jest.fn().mockImplementation((args) => {
                capturedFindManyArgs = args;
                return Promise.resolve([]);
              }),
            },
          };

          return callback(tx);
        },
      );
      (prismaService.assignment.findUnique as jest.Mock).mockResolvedValue({
        ...mockExistingAssignment,
        questions: [],
        questionOrder: [],
        updatedAt: new Date(),
      });

      // Act
      await service.addContentToAssignment(
        mockAssignmentId,
        mockContentDto,
        mockUserId,
      );

      // Assert
      expect(capturedFindManyArgs).toBeDefined();
      expect(capturedFindManyArgs?.where).toEqual(
        expect.objectContaining({
          assignmentId: mockAssignmentId,
          isDeleted: false,
        }),
      );
      expect(capturedFindManyArgs?.orderBy).toEqual({ id: "asc" });
    });
  });
});
