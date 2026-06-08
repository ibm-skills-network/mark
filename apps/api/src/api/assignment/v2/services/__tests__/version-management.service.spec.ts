/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { UserRole } from "../../../../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../../../../database/prisma.service";
import { AttemptAccessCacheService } from "../../../../attempt/services/attempt-access-cache.service";
import { VersionManagementService } from "../version-management.service";

describe("VersionManagementService", () => {
  let service: VersionManagementService;

  const mockPrismaService = {
    assignment: {
      findUnique: jest.fn(),
    },
    assignmentVersion: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    questionVersion: {
      create: jest.fn(),
    },
    versionHistory: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockLogger = {
    child: jest.fn().mockReturnThis(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const mockAttemptAccessCache = {
    invalidateForAssignment: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VersionManagementService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: WINSTON_MODULE_PROVIDER,
          useValue: mockLogger,
        },
        {
          provide: AttemptAccessCacheService,
          useValue: mockAttemptAccessCache,
        },
      ],
    }).compile();

    service = module.get<VersionManagementService>(VersionManagementService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("restoreVersion cache invalidation", () => {
    const userSession = {
      userId: "author@example.com",
      role: UserRole.AUTHOR,
    } as never;

    it("invalidates the attempt-access cache after activating a published version", async () => {
      mockPrismaService.assignmentVersion.findUnique.mockResolvedValue({
        id: 50,
        assignmentId: 10,
        versionNumber: "0.0.7",
        versionDescription: "Stable release",
        published: true,
        isDraft: false,
        isActive: false,
        createdBy: "author@example.com",
        createdAt: new Date("2026-05-14T00:00:00.000Z"),
        questionVersions: [],
      });
      const tx = {
        assignmentVersion: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          update: jest.fn().mockResolvedValue({}),
        },
        assignment: { update: jest.fn().mockResolvedValue({}) },
        versionHistory: { create: jest.fn().mockResolvedValue({}) },
      };
      mockPrismaService.$transaction.mockImplementation(
        async (callback: (tx: unknown) => unknown) => callback(tx),
      );

      await service.restoreVersion(10, { versionId: 50 } as never, userSession);

      expect(
        mockAttemptAccessCache.invalidateForAssignment,
      ).toHaveBeenCalledWith(10);
    });

    it("does not invalidate the cache when activation fails because the version is unpublished", async () => {
      mockPrismaService.assignmentVersion.findUnique.mockResolvedValue({
        id: 50,
        assignmentId: 10,
        versionNumber: "0.0.7",
        published: false,
        isDraft: false,
        isActive: false,
        createdBy: "author@example.com",
        createdAt: new Date("2026-05-14T00:00:00.000Z"),
        questionVersions: [],
      });
      mockPrismaService.$transaction.mockImplementation(
        async (callback: (tx: unknown) => unknown) =>
          callback({
            assignmentVersion: { updateMany: jest.fn(), update: jest.fn() },
            assignment: { update: jest.fn() },
            versionHistory: { create: jest.fn() },
          }),
      );

      await expect(
        service.restoreVersion(10, { versionId: 50 } as never, userSession),
      ).rejects.toThrow(BadRequestException);

      expect(
        mockAttemptAccessCache.invalidateForAssignment,
      ).not.toHaveBeenCalled();
    });
  });

  describe("listVersions", () => {
    const mockUserSession = {
      userId: "user123",
      role: UserRole.AUTHOR,
    };

    it("should return versions for valid assignment", async () => {
      const mockAssignment = {
        id: 1,
        AssignmentAuthor: [{ userId: "user123" }],
      };

      const mockVersions = [
        {
          id: 1,
          versionNumber: 1,
          isActive: true,
          isDraft: false,
          createdBy: "user123",
          createdAt: new Date(),
          _count: { questionVersions: 5 },
        },
        {
          id: 2,
          versionNumber: 2,
          isActive: false,
          isDraft: true,
          createdBy: "user123",
          createdAt: new Date(),
          _count: { questionVersions: 3 },
        },
      ];

      mockPrismaService.assignment.findUnique.mockResolvedValue(mockAssignment);
      mockPrismaService.assignmentVersion.findMany.mockResolvedValue(
        mockVersions,
      );

      const result = await service.listVersions(1);

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty("versionNumber", 1);
      expect(result[0]).toHaveProperty("questionCount", 5);
      expect(result[1]).toHaveProperty("versionNumber", 2);
      expect(result[1]).toHaveProperty("questionCount", 3);
    });

    it("should throw NotFoundException for non-existent assignment", async () => {
      mockPrismaService.assignment.findUnique.mockResolvedValue(null);

      await expect(service.listVersions(999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("getVersion", () => {
    const mockUserSession = {
      userId: "user123",
      role: UserRole.AUTHOR,
    };

    it("should return version details", async () => {
      const mockVersion = {
        id: 1,
        assignmentId: 1,
        versionNumber: 1,
        name: "Test Assignment",
        questionVersions: [{ id: 1, question: "What is 2+2?" }],
      };

      mockPrismaService.assignmentVersion.findUnique.mockResolvedValue(
        mockVersion,
      );

      const result = await service.getVersion(1, 1);

      expect(result).toMatchObject(mockVersion);
      expect(result.questionVersions[0].variants).toEqual([]);
      expect(
        mockPrismaService.assignmentVersion.findUnique,
      ).toHaveBeenCalledWith({
        where: { id: 1, assignmentId: 1 },
        include: { questionVersions: { orderBy: { displayOrder: "asc" } } },
      });
    });

    it("should throw NotFoundException for non-existent version", async () => {
      mockPrismaService.assignmentVersion.findUnique.mockResolvedValue(null);

      await expect(service.getVersion(1, 999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("compareAssignmentData", () => {
    it("should detect assignment field changes", () => {
      const fromVersion = {
        name: "Old Name",
        introduction: "Old Introduction",
        published: false,
      };

      const toVersion = {
        name: "New Name",
        introduction: "Old Introduction",
        published: true,
      };

      const result = (service as any).compareAssignmentData(
        fromVersion,
        toVersion,
      );

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        field: "name",
        fromValue: "Old Name",
        toValue: "New Name",
        changeType: "modified",
      });
      expect(result[1]).toMatchObject({
        field: "published",
        fromValue: false,
        toValue: true,
        changeType: "modified",
      });
    });

    it("should handle null values", () => {
      const fromVersion = {
        name: "Test",
        introduction: null,
      };

      const toVersion = {
        name: "Test",
        introduction: "Added introduction",
      };

      const result = (service as any).compareAssignmentData(
        fromVersion,
        toVersion,
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        field: "introduction",
        fromValue: null,
        toValue: "Added introduction",
        changeType: "added",
      });
    });
  });

  describe("compareQuestionData", () => {
    it("should detect added questions", () => {
      const fromQuestions = [
        { id: 1, question: "Question 1", displayOrder: 1 },
      ];

      const toQuestions = [
        { id: 1, question: "Question 1", displayOrder: 1 },
        { id: 2, question: "Question 2", displayOrder: 2 },
      ];

      const result = (service as any).compareQuestionData(
        fromQuestions,
        toQuestions,
      );

      const addedChanges = result.filter((c: any) => c.changeType === "added");
      expect(addedChanges).toHaveLength(1);
      expect(addedChanges[0]).toMatchObject({
        questionId: 2,
        displayOrder: 2,
        changeType: "added",
      });
    });

    it("should detect removed questions", () => {
      const fromQuestions = [
        { id: 1, question: "Question 1", displayOrder: 1 },
        { id: 2, question: "Question 2", displayOrder: 2 },
      ];

      const toQuestions = [{ id: 1, question: "Question 1", displayOrder: 1 }];

      const result = (service as any).compareQuestionData(
        fromQuestions,
        toQuestions,
      );

      const removedChanges = result.filter(
        (c: any) => c.changeType === "removed",
      );
      expect(removedChanges).toHaveLength(1);
      expect(removedChanges[0]).toMatchObject({
        questionId: 2,
        displayOrder: 2,
        changeType: "removed",
      });
    });

    it("should detect modified questions", () => {
      const fromQuestions = [
        { id: 1, question: "Old Question", totalPoints: 5, displayOrder: 1 },
      ];

      const toQuestions = [
        { id: 1, question: "New Question", totalPoints: 10, displayOrder: 1 },
      ];

      const result = (service as any).compareQuestionData(
        fromQuestions,
        toQuestions,
      );

      const modifiedChanges = result.filter(
        (c: any) => c.changeType === "modified",
      );
      expect(modifiedChanges).toHaveLength(2);

      expect(modifiedChanges).toContainEqual(
        expect.objectContaining({
          questionId: 1,
          field: "question",
          fromValue: "Old Question",
          toValue: "New Question",
          changeType: "modified",
        }),
      );

      expect(modifiedChanges).toContainEqual(
        expect.objectContaining({
          questionId: 1,
          field: "totalPoints",
          fromValue: 5,
          toValue: 10,
          changeType: "modified",
        }),
      );
    });
  });

  describe("question ordering in version snapshots", () => {
    const mockUserSession = {
      userId: "user123",
      role: UserRole.AUTHOR,
    };

    const buildQuestion = (id: number, question: string) => ({
      id,
      totalPoints: 5,
      authorComment: null,
      type: "TEXT",
      responseType: "ESSAY",
      question,
      maxWords: null,
      scoring: null,
      choices: null,
      randomizedChoices: false,
      answer: null,
      gradingContextQuestionIds: [],
      maxCharacters: null,
      videoPresentationConfig: null,
      liveRecordingConfig: null,
    });

    const buildAssignment = () => ({
      id: 1,
      currentVersionId: null,
      name: "Assignment",
      introduction: null,
      instructions: null,
      gradingCriteriaOverview: null,
      timeEstimateMinutes: null,
      type: "MANUAL",
      graded: false,
      numAttempts: 1,
      attemptsBeforeCoolDown: 1,
      retakeAttemptCoolDownMinutes: 5,
      allotedTimeMinutes: null,
      attemptsPerTimeRange: null,
      attemptsTimeRangeHours: null,
      passingGrade: 50,
      displayOrder: "DEFINED",
      questionDisplay: "ONE_PER_PAGE",
      numberOfQuestionsPerAttempt: null,
      questionOrder: [2, 1],
      published: true,
      showAssignmentScore: true,
      showQuestionScore: true,
      showSubmissionFeedback: true,
      showQuestions: true,
      correctAnswerVisibility: "NEVER",
      questionControls: null,
      languageCode: "en",
      questions: [
        buildQuestion(1, "Question 1"),
        buildQuestion(2, "Question 2"),
      ],
      versions: [],
    });

    it("creates question versions using assignment.questionOrder", async () => {
      const assignment = buildAssignment();
      const tx = {
        assignmentVersion: {
          create: jest.fn().mockResolvedValue({
            id: 10,
            versionNumber: "1.0.0",
            versionDescription: "Version 1",
            isDraft: false,
            isActive: false,
            published: true,
            createdBy: mockUserSession.userId,
            createdAt: new Date(),
          }),
        },
        questionVersion: {
          create: jest.fn().mockResolvedValue({ id: 100 }),
        },
        versionHistory: {
          create: jest.fn().mockResolvedValue({}),
        },
      };

      mockPrismaService.assignment.findUnique.mockResolvedValue(assignment);
      mockPrismaService.assignmentVersion.findFirst.mockResolvedValue(null);
      mockPrismaService.$transaction.mockImplementation(async (callback) =>
        callback(tx),
      );

      await service.createVersion(
        1,
        {
          versionNumber: "1.0.0",
          versionDescription: "Version 1",
          isDraft: false,
          shouldActivate: false,
        },
        mockUserSession as any,
      );

      expect(
        tx.questionVersion.create.mock.calls.map(
          (call) => call[0].data.questionId,
        ),
      ).toEqual([2, 1]);
      expect(
        tx.questionVersion.create.mock.calls.map(
          (call) => call[0].data.displayOrder,
        ),
      ).toEqual([1, 2]);
    });

    it("updates existing versions using assignment.questionOrder", async () => {
      const assignment = buildAssignment();
      const tx = {
        assignmentVersion: {
          update: jest.fn().mockResolvedValue({
            id: 10,
            versionNumber: "1.0.1",
            versionDescription: "Updated version",
            isDraft: false,
            isActive: false,
            published: true,
            createdBy: mockUserSession.userId,
            createdAt: new Date(),
            _count: { questionVersions: 2 },
          }),
        },
        questionVersion: {
          deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
          create: jest.fn().mockResolvedValue({ id: 200 }),
        },
        versionHistory: {
          create: jest.fn().mockResolvedValue({}),
        },
      };

      mockPrismaService.assignment.findUnique.mockResolvedValue(assignment);
      mockPrismaService.$transaction.mockImplementation(async (callback) =>
        callback(tx),
      );

      await service["updateExistingVersion"](
        1,
        10,
        {
          versionDescription: "Updated version",
          isDraft: false,
          shouldActivate: false,
        },
        mockUserSession as any,
      );

      expect(
        tx.questionVersion.create.mock.calls.map(
          (call) => call[0].data.questionId,
        ),
      ).toEqual([2, 1]);
      expect(
        tx.questionVersion.create.mock.calls.map(
          (call) => call[0].data.displayOrder,
        ),
      ).toEqual([1, 2]);
    });
  });
});
