/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { UserRole } from "../../../../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../../../../prisma.service";
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
    warn: jest.fn(),
    error: jest.fn(),
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
      ],
    }).compile();

    service = module.get<VersionManagementService>(VersionManagementService);
  });

  afterEach(() => {
    jest.clearAllMocks();
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

      expect(result).toEqual(mockVersion);
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

      // Access private method for testing
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
      expect(modifiedChanges).toHaveLength(2); // question text and totalPoints

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
});
