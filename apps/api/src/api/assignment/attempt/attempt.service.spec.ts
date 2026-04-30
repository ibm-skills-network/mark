/* eslint-disable */
import { HttpService } from "@nestjs/axios";
import { UnprocessableEntityException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { LtiSyncStatus } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { PrismaService } from "../../../database/prisma.service";
import { LlmFacadeService } from "../../llm/llm-facade.service";
import { QuestionService } from "../question/question.service";
import { AssignmentServiceV1 } from "../v1/services/assignment.service";
import { AttemptServiceV1 } from "./attempt.service";
import { LtiGradeSyncService } from "../../attempt/services/lti-grade-sync.service";

describe("AttemptServiceV1 - Auto-Grade Expired Attempts", () => {
  let service: AttemptServiceV1;
  let prismaService: PrismaService;
  let ltiGradeSyncService: any;

  const mockPrismaService = {
    assignmentAttempt: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    assignment: {
      findUnique: jest.fn(),
    },
    question: {
      findMany: jest.fn(),
    },
    questionResponse: {
      findMany: jest.fn(),
    },
    ltiGradeSync: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockLtiGradeSyncService = {
    createAndSync: jest.fn(),
  };

  const mockHttpService = {
    put: jest.fn(),
  };

  const mockLlmFacadeService = {};
  const mockQuestionService = {};
  const mockAssignmentService = {
    findOne: jest.fn(),
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
        AttemptServiceV1,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: HttpService, useValue: mockHttpService },
        { provide: LlmFacadeService, useValue: mockLlmFacadeService },
        { provide: QuestionService, useValue: mockQuestionService },
        { provide: AssignmentServiceV1, useValue: mockAssignmentService },
        { provide: LtiGradeSyncService, useValue: mockLtiGradeSyncService },
        { provide: WINSTON_MODULE_PROVIDER, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<AttemptServiceV1>(AttemptServiceV1);
    prismaService = module.get<PrismaService>(PrismaService);
    ltiGradeSyncService = mockLtiGradeSyncService;

    jest.clearAllMocks();
  });

  describe("autoGradeExpiredAttempt", () => {
    it("should auto-grade expired attempt with saved responses", async () => {
      const attemptId = 1;
      const assignment = {
        id: 1,
        numAttempts: 3,
        attemptsPerTimeRange: null,
        timeRangeInHours: null,
        attemptsBeforeCoolDown: null,
        retakeAttemptCoolDownMinutes: null,
      };

      const mockAttempt = {
        id: attemptId,
        assignmentId: 1,
        userId: "user-123",
        submitted: false,
        expiresAt: new Date(Date.now() - 60_000),
        questionResponses: [
          { questionId: 1, points: 8 },
          { questionId: 2, points: 7 },
        ],
        questionVariants: [],
      };

      const mockQuestions = [
        { id: 1, totalPoints: 10, isDeleted: false },
        { id: 2, totalPoints: 10, isDeleted: false },
        {
          id: 3,
          totalPoints: 10,
          isDeleted: false,
        },
      ];

      mockPrismaService.assignmentAttempt.findUnique.mockResolvedValue(
        mockAttempt,
      );
      mockPrismaService.question.findMany.mockResolvedValue(mockQuestions);
      mockPrismaService.assignmentAttempt.update.mockResolvedValue({
        ...mockAttempt,
        submitted: true,
        grade: 0.5,
      });

      const userSession = { userId: "user-123", role: "learner" as const };
      mockPrismaService.assignmentAttempt.findMany.mockResolvedValue([
        mockAttempt,
      ]);
      mockAssignmentService.findOne.mockResolvedValue(assignment);

      await expect(
        service["validateNewAttempt"](assignment, userSession),
      ).resolves.not.toThrow();

      expect(mockPrismaService.assignmentAttempt.update).toHaveBeenCalledWith({
        where: { id: attemptId },
        data: expect.objectContaining({
          submitted: true,
          grade: 0.5,
          comments: expect.stringContaining("automatically submitted"),
        }),
      });
    });

    it("should handle expired attempt with no responses", async () => {
      const attemptId = 1;
      const assignment = {
        id: 1,
        numAttempts: 3,
        attemptsPerTimeRange: null,
        timeRangeInHours: null,
        attemptsBeforeCoolDown: null,
        retakeAttemptCoolDownMinutes: null,
      };

      const mockAttempt = {
        id: attemptId,
        assignmentId: 1,
        userId: "user-123",
        submitted: false,
        expiresAt: new Date(Date.now() - 60_000),
        questionResponses: [],
        questionVariants: [],
      };

      const mockQuestions = [
        { id: 1, totalPoints: 10, isDeleted: false },
        { id: 2, totalPoints: 10, isDeleted: false },
      ];

      mockPrismaService.assignmentAttempt.findUnique.mockResolvedValue(
        mockAttempt,
      );
      mockPrismaService.question.findMany.mockResolvedValue(mockQuestions);
      mockPrismaService.assignmentAttempt.update.mockResolvedValue({
        ...mockAttempt,
        submitted: true,
        grade: 0,
      });

      const userSession = { userId: "user-123", role: "learner" as const };
      mockPrismaService.assignmentAttempt.findMany.mockResolvedValue([
        mockAttempt,
      ]);
      mockAssignmentService.findOne.mockResolvedValue(assignment);

      await expect(
        service["validateNewAttempt"](assignment, userSession),
      ).resolves.not.toThrow();

      expect(mockPrismaService.assignmentAttempt.update).toHaveBeenCalledWith({
        where: { id: attemptId },
        data: expect.objectContaining({
          submitted: true,
          grade: 0,
          comments: expect.stringContaining("No responses were recorded"),
        }),
      });
    });

    it("should not auto-grade already submitted attempts", async () => {
      const mockAttempt = {
        id: 1,
        submitted: true,
        expiresAt: new Date(Date.now() - 60_000),
      };

      mockPrismaService.assignmentAttempt.findUnique.mockResolvedValue(
        mockAttempt,
      );

      await service["autoGradeExpiredAttempt"](1, {} as any);

      expect(mockPrismaService.assignmentAttempt.update).not.toHaveBeenCalled();
    });

    it("should calculate grade correctly with partial responses", async () => {
      const mockAttempt = {
        id: 1,
        assignmentId: 1,
        submitted: false,
        expiresAt: new Date(Date.now() - 60_000),
        questionResponses: [
          {
            questionId: 1,
            points: 10,
          },
          {
            questionId: 2,
            points: 5,
          },
        ],
        questionVariants: [],
      };

      const mockQuestions = [
        { id: 1, totalPoints: 10, isDeleted: false },
        { id: 2, totalPoints: 10, isDeleted: false },
        { id: 3, totalPoints: 10, isDeleted: false },
      ];

      mockPrismaService.assignmentAttempt.findUnique.mockResolvedValue(
        mockAttempt,
      );
      mockPrismaService.question.findMany.mockResolvedValue(mockQuestions);

      await service["autoGradeExpiredAttempt"](1, {} as any);

      expect(mockPrismaService.assignmentAttempt.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: expect.objectContaining({
          grade: 0.5,
        }),
      });
    });
  });

  describe("validateNewAttempt - Expired Attempt Closure", () => {
    it("should close multiple expired attempts before creating new one", async () => {
      const assignment = {
        id: 1,
        numAttempts: 5,
        attemptsPerTimeRange: null,
        timeRangeInHours: null,
        attemptsBeforeCoolDown: null,
        retakeAttemptCoolDownMinutes: null,
      };

      const userSession = { userId: "user-123", role: "learner" as const };

      const expiredAttempts = [
        {
          id: 1,
          submitted: false,
          expiresAt: new Date(Date.now() - 120_000),
          questionResponses: [{ questionId: 1, points: 8 }],
          questionVariants: [],
        },
        {
          id: 2,
          submitted: false,
          expiresAt: new Date(Date.now() - 60_000),
          questionResponses: [{ questionId: 1, points: 9 }],
          questionVariants: [],
        },
      ];

      mockPrismaService.assignmentAttempt.findMany.mockResolvedValue(
        expiredAttempts,
      );
      mockPrismaService.assignmentAttempt.findUnique
        .mockResolvedValueOnce(expiredAttempts[0])
        .mockResolvedValueOnce(expiredAttempts[1]);
      mockPrismaService.question.findMany.mockResolvedValue([
        { id: 1, totalPoints: 10, isDeleted: false },
      ]);
      mockAssignmentService.findOne.mockResolvedValue(assignment);

      await service["validateNewAttempt"](assignment, userSession);

      expect(mockPrismaService.assignmentAttempt.update).toHaveBeenCalledTimes(
        2,
      );
    });

    it("should not block new attempt after closing expired ones", async () => {
      const assignment = {
        id: 1,
        numAttempts: 3,
        attemptsPerTimeRange: null,
        timeRangeInHours: null,
        attemptsBeforeCoolDown: null,
        retakeAttemptCoolDownMinutes: null,
      };

      const userSession = { userId: "user-123", role: "learner" as const };

      const expiredAttempt = {
        id: 1,
        submitted: false,
        expiresAt: new Date(Date.now() - 60_000),
        questionResponses: [],
        questionVariants: [],
        createdAt: new Date(),
      };

      mockPrismaService.assignmentAttempt.findMany.mockResolvedValue([
        expiredAttempt,
      ]);
      mockPrismaService.assignmentAttempt.findUnique.mockResolvedValue(
        expiredAttempt,
      );
      mockPrismaService.question.findMany.mockResolvedValue([]);
      mockAssignmentService.findOne.mockResolvedValue(assignment);

      await expect(
        service["validateNewAttempt"](assignment, userSession),
      ).resolves.not.toThrow();
    });
  });

  describe("updateAssignmentAttempt - Timeout Grading", () => {
    it("should grade late submission with saved responses", async () => {
      const attemptId = 1;
      const assignmentId = 1;

      const mockAttempt = {
        id: attemptId,
        assignmentId,
        expiresAt: new Date(Date.now() - 20_000),
        submitted: false,
      };

      const savedResponses = [
        { questionId: 1, points: 8 },
        { questionId: 2, points: 7 },
      ];

      const mockQuestions = [
        { id: 1, totalPoints: 10, isDeleted: false },
        { id: 2, totalPoints: 10, isDeleted: false },
      ];

      mockPrismaService.assignmentAttempt.findUnique.mockResolvedValue(
        mockAttempt,
      );
      mockPrismaService.questionResponse.findMany.mockResolvedValue(
        savedResponses,
      );
      mockPrismaService.question.findMany.mockResolvedValue(mockQuestions);

      const updateDto = {
        submitted: true,
        responsesForQuestions: [],
      };

      const request = {
        userSession: { userId: "user-123", role: "learner" as const },
      };

      const result = await service.updateAssignmentAttempt(
        attemptId,
        assignmentId,
        updateDto as any,
        "auth-cookie",
        false,
        request as any,
      );

      expect(result.grade).toBe(0.75);
      expect(result.totalPointsEarned).toBe(15);
      expect(result.totalPossiblePoints).toBe(20);
      expect(result.message).toContain("saved responses have been graded");
    });

    it("should give zero grade for late submission with no saved responses", async () => {
      const attemptId = 1;
      const assignmentId = 1;

      const mockAttempt = {
        id: attemptId,
        assignmentId,
        expiresAt: new Date(Date.now() - 20_000),
        submitted: false,
      };

      mockPrismaService.assignmentAttempt.findUnique.mockResolvedValue(
        mockAttempt,
      );
      mockPrismaService.questionResponse.findMany.mockResolvedValue([]);
      mockPrismaService.question.findMany.mockResolvedValue([
        { id: 1, totalPoints: 10, isDeleted: false },
      ]);

      const updateDto = {
        submitted: true,
        responsesForQuestions: [],
      };

      const request = {
        userSession: { userId: "user-123", role: "learner" as const },
      };

      const result = await service.updateAssignmentAttempt(
        attemptId,
        assignmentId,
        updateDto as any,
        "auth-cookie",
        false,
        request as any,
      );

      expect(result.grade).toBe(0);
      expect(result.totalPointsEarned).toBe(0);
      expect(result.message).toContain("The attempt deadline has passed");
    });

    it("should allow submission within 10-second grace period", async () => {
      const attemptId = 1;
      const assignmentId = 1;

      const mockAttempt = {
        id: attemptId,
        assignmentId,
        expiresAt: new Date(Date.now() - 5000),
        submitted: false,
        questionVariants: [],
      };

      mockPrismaService.assignmentAttempt.findUnique.mockResolvedValue(
        mockAttempt,
      );
      mockPrismaService.assignmentAttempt.update.mockResolvedValue({
        ...mockAttempt,
        submitted: true,
      });
      mockPrismaService.assignment.findUnique.mockResolvedValue({
        showAssignmentScore: true,
        showSubmissionFeedback: true,
        showQuestionScore: true,
        showQuestions: true,
        currentVersion: { correctAnswerVisibility: "NEVER" },
        questions: [],
      });

      const updateDto = {
        submitted: true,
        responsesForQuestions: [],
      };

      const request = {
        userSession: { userId: "user-123", role: "learner" as const },
      };

      await service.updateAssignmentAttempt(
        attemptId,
        assignmentId,
        updateDto as any,
        "auth-cookie",
        false,
        request as any,
      );

      expect(
        mockPrismaService.questionResponse.findMany,
      ).not.toHaveBeenCalled();
    });
  });

  describe("queueGradeSyncAsync - LTI Grade Sync Integration", () => {
    it("should queue grade sync using LtiGradeSyncService", async () => {
      mockLtiGradeSyncService.createAndSync.mockResolvedValue({
        success: true,
        syncId: 1,
        status: LtiSyncStatus.SUCCESS,
      });

      await service["queueGradeSyncAsync"](
        123,
        "user-456",
        789,
        0.85,
        "auth-cookie",
      );

      expect(mockLtiGradeSyncService.createAndSync).toHaveBeenCalledWith({
        attemptId: 123,
        userId: "user-456",
        assignmentId: 789,
        grade: 0.85,
        authCookie: "auth-cookie",
      });
    });

    it("should fallback to legacy method if service unavailable", async () => {
      const moduleWithoutService = await Test.createTestingModule({
        providers: [
          AttemptServiceV1,
          { provide: PrismaService, useValue: mockPrismaService },
          { provide: HttpService, useValue: mockHttpService },
          { provide: LlmFacadeService, useValue: mockLlmFacadeService },
          { provide: QuestionService, useValue: mockQuestionService },
          { provide: AssignmentServiceV1, useValue: mockAssignmentService },
          { provide: WINSTON_MODULE_PROVIDER, useValue: mockLogger },
        ],
      }).compile();

      const serviceWithoutLtiSync =
        moduleWithoutService.get<AttemptServiceV1>(AttemptServiceV1);

      mockHttpService.put.mockReturnValue({
        toPromise: jest.fn().mockResolvedValue({ status: 200 }),
      });

      await serviceWithoutLtiSync["queueGradeSyncAsync"](
        123,
        "user-456",
        789,
        0.85,
        "auth-cookie",
      );

      expect(mockHttpService.put).toHaveBeenCalled();
    });

    it("should not throw error if grade sync fails", async () => {
      mockLtiGradeSyncService.createAndSync.mockRejectedValue(
        new Error("Network error"),
      );

      await expect(
        service["queueGradeSyncAsync"](
          123,
          "user-456",
          789,
          0.85,
          "auth-cookie",
        ),
      ).resolves.not.toThrow();
    });
  });
});
