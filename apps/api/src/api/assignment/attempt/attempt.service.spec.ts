/* eslint-disable */
import { NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { UserRole } from "../../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../../database/prisma.service";
import { AssignmentServiceV1 } from "../v1/services/assignment.service";
import { AttemptServiceV1 } from "./attempt.service";
import { GradingKillSwitchService } from "../../ai-feature-flags/grading-kill-switch.service";

describe("AttemptServiceV1 - Auto-Grade Expired Attempts", () => {
  let service: AttemptServiceV1;
  let prismaService: PrismaService;

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
      findUnique: jest.fn(),
    },
    questionResponse: {
      findMany: jest.fn(),
    },
    translation: {
      findMany: jest.fn(),
    },
    ltiGradeSync: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockGradingKillSwitch = {
    assertGradingAllowed: jest.fn(),
    assignmentUsesAiGrading: jest.fn(),
  };

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
        { provide: AssignmentServiceV1, useValue: mockAssignmentService },
        {
          provide: GradingKillSwitchService,
          useValue: mockGradingKillSwitch,
        },
        { provide: WINSTON_MODULE_PROVIDER, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<AttemptServiceV1>(AttemptServiceV1);
    prismaService = module.get<PrismaService>(PrismaService);

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

  describe("getAssignmentAttempt - assignment hydration", () => {
    const baseAttempt = {
      id: 555,
      assignmentId: 42,
      grade: 0.9,
      questionOrder: [],
      questionResponses: [],
      questionVariants: [],
    };

    const baseAssignment = {
      id: 42,
      name: "Hydration Assignment",
      introduction: "intro",
      instructions: "do the thing",
      gradingCriteriaOverview: "criteria",
      timeEstimateMinutes: 30,
      attemptsBeforeCoolDown: 2,
      retakeAttemptCoolDownMinutes: 10,
      type: "AI_GRADED",
      graded: true,
      numAttempts: 3,
      allotedTimeMinutes: 60,
      requireAllQuestions: true,
      optionalQuestionIds: [],
      questions: [],
      questionOrder: [],
      displayOrder: "DEFINED",
      passingGrade: 70,
      questionDisplay: "ONE_PER_PAGE",
      numberOfQuestionsPerAttempt: 5,
      published: true,
      showAssignmentScore: true,
      showSubmissionFeedback: true,
      showQuestionScore: true,
      showQuestions: true,
      questionControls: null,
      updatedAt: new Date("2024-01-01T00:00:00Z"),
      currentVersion: {
        correctAnswerVisibility: "ON_PASS",
        questionControls: { disableCopy: true },
      },
    };

    it("populates assignmentDetails from the loaded assignment", async () => {
      mockPrismaService.assignmentAttempt.findUnique.mockResolvedValue(
        baseAttempt,
      );
      mockPrismaService.assignment.findUnique.mockResolvedValue(baseAssignment);
      mockPrismaService.translation.findMany.mockResolvedValue([]);
      mockPrismaService.question.findMany.mockResolvedValue([]);

      const result = await service.getAssignmentAttempt(555, "en");

      expect(result.assignmentDetails).toEqual(
        expect.objectContaining({
          id: 42,
          name: "Hydration Assignment",
          passingGrade: 70,
          // derived from currentVersion, not the assignment row
          correctAnswerVisibility: "ON_PASS",
          questionControls: { disableCopy: true },
          updatedAt: baseAssignment.updatedAt,
        }),
      );
      // top-level fields stay in sync with the embedded details
      expect(result.correctAnswerVisibility).toBe("ON_PASS");
      expect(result.questionControls).toEqual({ disableCopy: true });
    });

    it("throws NotFoundException when the assignment is missing", async () => {
      mockPrismaService.assignmentAttempt.findUnique.mockResolvedValue(
        baseAttempt,
      );
      mockPrismaService.assignment.findUnique.mockResolvedValue(null);

      await expect(service.getAssignmentAttempt(555, "en")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("returns the grade when the assignment shows the score", async () => {
      mockPrismaService.assignmentAttempt.findUnique.mockResolvedValue(
        baseAttempt,
      );
      mockPrismaService.assignment.findUnique.mockResolvedValue(baseAssignment);
      mockPrismaService.translation.findMany.mockResolvedValue([]);
      mockPrismaService.question.findMany.mockResolvedValue([]);

      const result = await service.getAssignmentAttempt(555, "en");

      expect(result.grade).toBe(0.9);
    });

    // The attempt row is spread into the response, so the persisted grade
    // reaches the learner unless it is explicitly overridden.
    it("withholds the grade when the assignment hides the score", async () => {
      mockPrismaService.assignmentAttempt.findUnique.mockResolvedValue(
        baseAttempt,
      );
      mockPrismaService.assignment.findUnique.mockResolvedValue({
        ...baseAssignment,
        showAssignmentScore: false,
      });
      mockPrismaService.translation.findMany.mockResolvedValue([]);
      mockPrismaService.question.findMany.mockResolvedValue([]);

      const result = await service.getAssignmentAttempt(555, "en");

      expect(result.grade).toBeNull();
      expect(result.showAssignmentScore).toBe(false);
    });

    // Pass/fail lives on the completed and submit responses, which apply the
    // over-scoring clamp this route does not.
    it("carries no pass/fail verdict", async () => {
      mockPrismaService.assignmentAttempt.findUnique.mockResolvedValue(
        baseAttempt,
      );
      mockPrismaService.assignment.findUnique.mockResolvedValue({
        ...baseAssignment,
        showPassFailIndicator: true,
      });
      mockPrismaService.translation.findMany.mockResolvedValue([]);
      mockPrismaService.question.findMany.mockResolvedValue([]);

      const result = await service.getAssignmentAttempt(555, "en");

      expect(result.passed).toBeUndefined();
    });

    // The 0-1 grade used to be compared raw against the 0-100 passing grade,
    // so ON_PASS behaved like NEVER: 0.9 < 70 hid the answers from a learner
    // who scored 90% against a 70% threshold.
    it("shows correct answers under ON_PASS when the grade meets the passing grade", async () => {
      mockPrismaService.assignmentAttempt.findUnique.mockResolvedValue(
        baseAttempt,
      );
      mockPrismaService.assignment.findUnique.mockResolvedValue(baseAssignment);
      mockPrismaService.translation.findMany.mockResolvedValue([]);
      mockPrismaService.question.findMany.mockResolvedValue([
        {
          id: 7,
          answer: "the answer",
          choices: [
            { choice: "A", isCorrect: true, points: 1, feedback: "right" },
          ],
        },
      ]);

      const result = await service.getAssignmentAttempt(555, "en");

      const [question] = result.questions;
      expect(question.choices[0].isCorrect).toBe(true);
      expect(question.choices[0].feedback).toBe("right");
      // points are stripped regardless of pass/fail
      expect(question.choices[0].points).toBeUndefined();
      expect(question.answer).toBe("the answer");
    });

    it("hides correct answers under ON_PASS when the grade is below the passing grade", async () => {
      mockPrismaService.assignmentAttempt.findUnique.mockResolvedValue({
        ...baseAttempt,
        grade: 0.5,
      });
      mockPrismaService.assignment.findUnique.mockResolvedValue(baseAssignment);
      mockPrismaService.translation.findMany.mockResolvedValue([]);
      mockPrismaService.question.findMany.mockResolvedValue([
        {
          id: 7,
          answer: "the answer",
          choices: [
            { choice: "A", isCorrect: true, points: 1, feedback: "right" },
          ],
        },
      ]);

      const result = await service.getAssignmentAttempt(555, "en");

      const [question] = result.questions;
      expect(question.choices[0].isCorrect).toBeUndefined();
      expect(question.choices[0].feedback).toBeUndefined();
      expect(question.answer).toBeUndefined();
    });

    // The response used to embed every language's translation of every
    // question. With images inlined in question HTML that multiplied each
    // image by the language count (assignment 2532 shipped ~4MB attempts,
    // overflowing the client's localStorage quota). Only the requested
    // language family may be fetched.
    it("fetches translations only for the requested language family", async () => {
      mockPrismaService.assignmentAttempt.findUnique.mockResolvedValue({
        ...baseAttempt,
        questionOrder: [7],
        questionVariants: [
          { questionId: 7, questionVariant: null, randomizedChoices: null },
        ],
      });
      mockPrismaService.assignment.findUnique.mockResolvedValue({
        ...baseAssignment,
        questions: [
          {
            id: 7,
            assignmentId: 42,
            question: "Pick one",
            type: "SINGLE_CORRECT",
            totalPoints: 1,
            choices: [{ choice: "A", isCorrect: true, points: 1 }],
          },
        ],
      });
      mockPrismaService.translation.findMany.mockResolvedValue([
        {
          questionId: 7,
          variantId: null,
          languageCode: "zh-CN",
          translatedText: "选一个",
          translatedChoices: [{ choice: "甲" }],
        },
      ]);
      mockPrismaService.question.findMany.mockResolvedValue([]);

      const result = await service.getAssignmentAttempt(555, "zh-CN");

      expect(mockPrismaService.translation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            languageCode: { startsWith: "zh" },
          }),
        }),
      );
      const [question] = result.questions;
      expect(question.translations["zh-CN"]).toEqual(
        expect.objectContaining({ translatedText: "选一个" }),
      );
    });
  });
});

describe("AttemptServiceV1 - server clock and blank expired submissions", () => {
  let service: AttemptServiceV1;

  const warn = jest.fn();
  const childLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn,
    debug: jest.fn(),
  };

  const mockPrismaService = {
    assignmentAttempt: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    assignmentAttemptQuestionVariant: {
      createMany: jest.fn(),
    },
    assignment: { findUnique: jest.fn() },
    question: { findMany: jest.fn(), findUnique: jest.fn() },
    questionResponse: { findMany: jest.fn(), create: jest.fn() },
    translation: { findMany: jest.fn() },
    ltiGradeSync: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockAssignmentService = { findOne: jest.fn() };
  const mockGradingKillSwitch = {
    assertGradingAllowed: jest.fn(),
    assignmentUsesAiGrading: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttemptServiceV1,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AssignmentServiceV1, useValue: mockAssignmentService },
        { provide: GradingKillSwitchService, useValue: mockGradingKillSwitch },
        {
          provide: WINSTON_MODULE_PROVIDER,
          useValue: { child: jest.fn().mockReturnValue(childLogger) },
        },
      ],
    }).compile();

    service = module.get<AttemptServiceV1>(AttemptServiceV1);
    jest.clearAllMocks();
  });

  it("returns the server clock with a newly created attempt", async () => {
    mockAssignmentService.findOne.mockResolvedValue({
      id: 3663,
      numAttempts: -1,
      allotedTimeMinutes: 20,
      questionOrder: [],
      displayOrder: "DEFINED",
      numberOfQuestionsPerAttempt: null,
    });
    mockGradingKillSwitch.assertGradingAllowed.mockResolvedValue(undefined);
    mockPrismaService.assignmentAttempt.findMany.mockResolvedValue([]);
    mockPrismaService.assignmentAttempt.create.mockResolvedValue({ id: 2493 });
    mockPrismaService.assignmentAttempt.update.mockResolvedValue({});
    mockPrismaService.question.findMany.mockResolvedValue([]);
    mockPrismaService.assignmentAttemptQuestionVariant.createMany.mockResolvedValue(
      { count: 0 },
    );

    const before = Date.now();
    const result = await service.createAssignmentAttempt(3663, {
      userId: "learner@example.com",
      role: UserRole.LEARNER,
    } as any);
    const after = Date.now();

    expect(result.id).toBe(2493);
    expect(typeof result.serverNow).toBe("string");
    const parsed = Date.parse(result.serverNow as string);
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });
});
