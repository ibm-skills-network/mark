import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { RegradingStatus } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { EmailService } from "../../common/services/email.service";
import { LLM_PRICING_SERVICE } from "../llm/llm.constants";
import { AdminService } from "./admin.service";

describe("AdminService", () => {
  let service: AdminService;
  let prismaService: PrismaService;
  let emailService: EmailService;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  const mockPrismaService = {
    regradingRequest: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    assignmentAttempt: {
      update: jest.fn(),
    },
    assignmentAuthor: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  const mockEmailService = {
    sendGradeUpdateNotification: jest.fn(),
  };

  const mockLlmPricingService = {
    calculateCost: jest.fn().mockReturnValue(0.01),
    getTokenCount: jest.fn().mockReturnValue(100),
    calculateCostWithBreakdown: jest.fn().mockResolvedValue({
      totalCost: 0.01,
      inputCost: 0.005,
      outputCost: 0.005,
      modelKey: "gpt-4o",
      inputTokenPrice: 0.000_001,
      outputTokenPrice: 0.000_002,
      pricingEffectiveDate: new Date(),
    }),
  };

  beforeAll(() => {
    process.env.DATABASE_URL =
      originalDatabaseUrl ?? "postgresql://user:pass@localhost:5432/test";
  });

  afterAll(() => {
    if (originalDatabaseUrl) {
      process.env.DATABASE_URL = originalDatabaseUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: LLM_PRICING_SERVICE, useValue: mockLlmPricingService },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
    prismaService = module.get<PrismaService>(PrismaService);
    emailService = module.get<EmailService>(EmailService);

    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("Regrading Request Management", () => {
    describe("approveRegradingRequest", () => {
      const mockRequest = {
        id: 1,
        assignmentId: 10,
        attemptId: 20,
        userId: "learner@example.com",
        regradingStatus: RegradingStatus.PENDING,
        regradingReason: "I believe my answer was correct",
        proposedGrade: 80,
        questionIds: [1, 2],
        createdAt: new Date(),
        updatedAt: new Date(),
        assignment: { name: "Test Assignment" },
        assignmentAttempt: { grade: 0.5 },
      };

      it("should approve regrading request and update grade", async () => {
        mockPrismaService.regradingRequest.findUnique.mockResolvedValue(
          mockRequest,
        );
        mockPrismaService.regradingRequest.update.mockResolvedValue({
          ...mockRequest,
          regradingStatus: RegradingStatus.APPROVED,
        });
        mockPrismaService.assignmentAttempt.update.mockResolvedValue({
          id: 20,
          grade: 0.85,
        });
        mockEmailService.sendGradeUpdateNotification.mockResolvedValue();

        const result = await service.approveRegradingRequest(1, 0.85);

        expect(result).toEqual({ success: true });
        expect(mockPrismaService.regradingRequest.update).toHaveBeenCalledWith({
          where: { id: 1 },
          data: {
            regradingStatus: "APPROVED",
            processedBy: null,
          },
        });
        expect(mockPrismaService.assignmentAttempt.update).toHaveBeenCalledWith(
          {
            where: { id: 20 },
            data: { grade: 0.85 },
          },
        );
        expect(
          mockEmailService.sendGradeUpdateNotification,
        ).toHaveBeenCalledWith(
          "learner@example.com",
          "Test Assignment",
          10,
          20,
          0.5,
          0.85,
          "APPROVED",
        );
      });

      it("should throw error when request not found", async () => {
        mockPrismaService.regradingRequest.findUnique.mockResolvedValue(null);

        await expect(
          service.approveRegradingRequest(999, 0.85),
        ).rejects.toThrow("Regrading request with ID 999 not found");
      });

      it("should handle email notification failure gracefully", async () => {
        mockPrismaService.regradingRequest.findUnique.mockResolvedValue(
          mockRequest,
        );
        mockPrismaService.regradingRequest.update.mockResolvedValue({
          ...mockRequest,
          regradingStatus: RegradingStatus.APPROVED,
        });
        mockPrismaService.assignmentAttempt.update.mockResolvedValue({
          id: 20,
          grade: 0.85,
        });
        mockEmailService.sendGradeUpdateNotification.mockRejectedValue(
          new Error("Email service error"),
        );

        const result = await service.approveRegradingRequest(1, 0.85);
        expect(result).toEqual({ success: true });
      });

      it("should convert percentage grade to decimal correctly", async () => {
        mockPrismaService.regradingRequest.findUnique.mockResolvedValue(
          mockRequest,
        );
        mockPrismaService.regradingRequest.update.mockResolvedValue({
          ...mockRequest,
          regradingStatus: RegradingStatus.APPROVED,
        });
        mockPrismaService.assignmentAttempt.update.mockResolvedValue({
          id: 20,
          grade: 0.95,
        });
        mockEmailService.sendGradeUpdateNotification.mockResolvedValue();

        await service.approveRegradingRequest(1, 0.95);

        expect(mockPrismaService.assignmentAttempt.update).toHaveBeenCalledWith(
          {
            where: { id: 20 },
            data: { grade: 0.95 },
          },
        );
      });
    });

    describe("rejectRegradingRequest", () => {
      const mockRequest = {
        id: 1,
        assignmentId: 10,
        attemptId: 20,
        userId: "learner@example.com",
        regradingStatus: RegradingStatus.PENDING,
        regradingReason: "I believe my answer was correct",
        proposedGrade: 80,
        questionIds: [1, 2],
        createdAt: new Date(),
        updatedAt: new Date(),
        assignment: { name: "Test Assignment" },
        assignmentAttempt: { grade: 0.6 },
      };

      it("should reject regrading request with reason", async () => {
        mockPrismaService.regradingRequest.findUnique.mockResolvedValue(
          mockRequest,
        );
        mockPrismaService.regradingRequest.update.mockResolvedValue({
          ...mockRequest,
          regradingStatus: RegradingStatus.REJECTED,
          regradingReason: "The grading was correct as per rubric",
        });
        mockEmailService.sendGradeUpdateNotification.mockResolvedValue();

        const result = await service.rejectRegradingRequest(
          1,
          "The grading was correct as per rubric",
        );

        expect(result).toEqual({ success: true });
        expect(mockPrismaService.regradingRequest.update).toHaveBeenCalledWith({
          where: { id: 1 },
          data: {
            regradingStatus: "REJECTED",
            regradingReason: "The grading was correct as per rubric",
            processedBy: null,
          },
        });
        expect(
          mockEmailService.sendGradeUpdateNotification,
        ).toHaveBeenCalledWith(
          "learner@example.com",
          "Test Assignment",
          10,
          20,
          0.6,
          0.6,
          "REJECTED",
        );
      });

      it("should throw error when request not found", async () => {
        mockPrismaService.regradingRequest.findUnique.mockResolvedValue(null);

        await expect(
          service.rejectRegradingRequest(999, "Not valid"),
        ).rejects.toThrow("Regrading request with ID 999 not found");
      });

      it("should not change grade when rejecting", async () => {
        mockPrismaService.regradingRequest.findUnique.mockResolvedValue(
          mockRequest,
        );
        mockPrismaService.regradingRequest.update.mockResolvedValue({
          ...mockRequest,
          regradingStatus: RegradingStatus.REJECTED,
        });
        mockEmailService.sendGradeUpdateNotification.mockResolvedValue();

        await service.rejectRegradingRequest(1, "Grading is correct");

        expect(
          mockPrismaService.assignmentAttempt.update,
        ).not.toHaveBeenCalled();
        expect(
          mockEmailService.sendGradeUpdateNotification,
        ).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          expect.any(Number),
          expect.any(Number),
          0.6,
          0.6,
          "REJECTED",
        );
      });
    });

    describe("dismissFlaggedSubmission", () => {
      const mockRequest = {
        id: 1,
        assignmentId: 10,
        attemptId: 20,
        userId: "learner@example.com",
        regradingStatus: RegradingStatus.PENDING,
        regradingReason: "Flagged for review",
        proposedGrade: null,
        questionIds: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        assignment: { name: "Test Assignment" },
        assignmentAttempt: { grade: 0.7 },
      };

      it("should dismiss flagged submission", async () => {
        mockPrismaService.regradingRequest.findUnique.mockResolvedValue(
          mockRequest,
        );
        mockPrismaService.regradingRequest.update.mockResolvedValue({
          ...mockRequest,
          regradingStatus: RegradingStatus.REJECTED,
        });
        mockEmailService.sendGradeUpdateNotification.mockResolvedValue();

        const result = await service.dismissFlaggedSubmission(1);

        expect(result).toEqual({
          ...mockRequest,
          regradingStatus: RegradingStatus.REJECTED,
        });
        expect(mockPrismaService.regradingRequest.update).toHaveBeenCalledWith({
          where: { id: 1 },
          data: { regradingStatus: "REJECTED" },
        });
        expect(
          mockEmailService.sendGradeUpdateNotification,
        ).toHaveBeenCalledWith(
          "learner@example.com",
          "Test Assignment",
          10,
          20,
          0.7,
          0.7,
          "REJECTED",
        );
      });

      it("should throw error when request not found", async () => {
        mockPrismaService.regradingRequest.findUnique.mockResolvedValue(null);

        await expect(service.dismissFlaggedSubmission(999)).rejects.toThrow(
          "Regrading request with ID 999 not found",
        );
      });

      it("should handle email failure gracefully", async () => {
        mockPrismaService.regradingRequest.findUnique.mockResolvedValue(
          mockRequest,
        );
        mockPrismaService.regradingRequest.update.mockResolvedValue({
          ...mockRequest,
          regradingStatus: RegradingStatus.REJECTED,
        });
        mockEmailService.sendGradeUpdateNotification.mockRejectedValue(
          new Error("Email error"),
        );

        const result = await service.dismissFlaggedSubmission(1);

        expect(result).toBeDefined();
        expect(result.regradingStatus).toBe(RegradingStatus.REJECTED);
      });
    });

    describe("getRegradingRequests", () => {
      it("should return all regrading requests", async () => {
        const now = new Date();
        const mockRequests = [
          {
            id: 1,
            assignmentId: 10,
            attemptId: 20,
            userId: "learner1@example.com",
            regradingStatus: RegradingStatus.PENDING,
            createdAt: now,
            updatedAt: null,
            assignment: { id: 10, name: "Assignment 1" },
            assignmentAttempt: {
              id: 20,
              userId: "learner1@example.com",
              grade: 0.5,
              createdAt: now,
            },
          },
          {
            id: 2,
            assignmentId: 11,
            attemptId: 21,
            userId: "learner2@example.com",
            regradingStatus: RegradingStatus.APPROVED,
            createdAt: now,
            updatedAt: null,
            assignment: { id: 11, name: "Assignment 2" },
            assignmentAttempt: {
              id: 21,
              userId: "learner2@example.com",
              grade: 0.8,
              createdAt: now,
            },
          },
        ];

        mockPrismaService.regradingRequest.findMany.mockResolvedValue(
          mockRequests,
        );

        const result = await service.getRegradingRequests();

        // The service converts Date objects to ISO strings
        const expectedResult = mockRequests.map((request) => ({
          id: request.id,
          assignmentId: request.assignmentId,
          attemptId: request.attemptId,
          userId: request.userId,
          regradingStatus: request.regradingStatus,
          createdAt: request.createdAt.toISOString(),
          updatedAt: null,
          assignment: request.assignment,
          assignmentAttempt: request.assignmentAttempt
            ? {
                id: request.assignmentAttempt.id,
                userId: request.assignmentAttempt.userId,
                grade: request.assignmentAttempt.grade,
                createdAt: request.assignmentAttempt.createdAt.toISOString(),
              }
            : null,
        }));

        expect(result).toEqual(expectedResult);
        expect(
          mockPrismaService.regradingRequest.findMany,
        ).toHaveBeenCalledWith({
          orderBy: { createdAt: "desc" },
          include: {
            assignment: { select: { id: true, name: true } },
            assignmentAttempt: {
              select: {
                id: true,
                userId: true,
                grade: true,
                createdAt: true,
              },
            },
          },
        });
      });
    });

    describe("getAuthorRegradingRequests", () => {
      it("should return regrading requests for author's assignments", async () => {
        const authorId = "author@example.com";
        const mockAuthorAssignments = [
          { assignmentId: 10 },
          { assignmentId: 11 },
        ];
        const mockRequests = [
          {
            id: 1,
            assignmentId: 10,
            attemptId: 20,
            userId: "learner@example.com",
            regradingStatus: RegradingStatus.PENDING,
            createdAt: new Date(),
            assignment: { id: 10, name: "Assignment 1" },
            assignmentAttempt: {
              id: 20,
              userId: "learner@example.com",
              grade: 0.5,
              createdAt: new Date(),
            },
          },
        ];

        mockPrismaService.assignmentAuthor.findMany.mockResolvedValue(
          mockAuthorAssignments,
        );
        mockPrismaService.regradingRequest.findMany.mockResolvedValue(
          mockRequests,
        );

        const result = await service.getAuthorRegradingRequests(authorId);

        expect(result).toEqual(mockRequests);
        expect(
          mockPrismaService.assignmentAuthor.findMany,
        ).toHaveBeenCalledWith({
          where: { userId: authorId },
          select: { assignmentId: true },
        });
        expect(
          mockPrismaService.regradingRequest.findMany,
        ).toHaveBeenCalledWith({
          where: { assignmentId: { in: [10, 11] } },
          include: {
            assignment: { select: { id: true, name: true } },
            assignmentAttempt: {
              select: {
                id: true,
                userId: true,
                grade: true,
                createdAt: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
        });
      });

      it("should return empty array when author has no assignments", async () => {
        mockPrismaService.assignmentAuthor.findMany.mockResolvedValue([]);

        const result =
          await service.getAuthorRegradingRequests("author@example.com");

        expect(result).toEqual([]);
      });

      it("should filter by assignmentId when provided", async () => {
        const authorId = "author@example.com";
        const assignmentId = 10;

        mockPrismaService.assignmentAuthor.findMany.mockResolvedValue([
          { assignmentId: 10 },
        ]);
        mockPrismaService.regradingRequest.findMany.mockResolvedValue([]);

        await service.getAuthorRegradingRequests(authorId, assignmentId);

        expect(
          mockPrismaService.assignmentAuthor.findMany,
        ).toHaveBeenCalledWith({
          where: { userId: authorId, assignmentId: 10 },
          select: { assignmentId: true },
        });
      });
    });

    describe("approveAuthorRegradingRequest", () => {
      const mockRequest = {
        id: 1,
        assignmentId: 10,
        attemptId: 20,
        userId: "learner@example.com",
        regradingStatus: RegradingStatus.PENDING,
        assignment: { name: "Test Assignment" },
      };

      it("should approve request when author owns the assignment", async () => {
        mockPrismaService.regradingRequest.findUnique.mockResolvedValue(
          mockRequest,
        );
        mockPrismaService.assignmentAuthor.findFirst.mockResolvedValue({
          assignmentId: 10,
          userId: "author@example.com",
        });
        mockPrismaService.regradingRequest.update.mockResolvedValue({
          ...mockRequest,
          regradingStatus: RegradingStatus.APPROVED,
        });
        mockPrismaService.assignmentAttempt.update.mockResolvedValue({
          id: 20,
          grade: 0.9,
        });

        const result = await service.approveAuthorRegradingRequest(
          1,
          90,
          "author@example.com",
        );

        expect(result).toEqual({ success: true });
        expect(
          mockPrismaService.assignmentAuthor.findFirst,
        ).toHaveBeenCalledWith({
          where: { assignmentId: 10, userId: "author@example.com" },
        });
      });

      it("should throw NotFoundException when request not found", async () => {
        mockPrismaService.regradingRequest.findUnique.mockResolvedValue(null);

        await expect(
          service.approveAuthorRegradingRequest(999, 90, "author@example.com"),
        ).rejects.toThrow(NotFoundException);
      });

      it("should throw NotFoundException when author does not own assignment", async () => {
        mockPrismaService.regradingRequest.findUnique.mockResolvedValue(
          mockRequest,
        );
        mockPrismaService.assignmentAuthor.findFirst.mockResolvedValue(null);

        await expect(
          service.approveAuthorRegradingRequest(1, 90, "different@example.com"),
        ).rejects.toThrow(
          new NotFoundException(
            "You do not have permission to manage this regrading request",
          ),
        );
      });
    });

    describe("rejectAuthorRegradingRequest", () => {
      const mockRequest = {
        id: 1,
        assignmentId: 10,
        attemptId: 20,
        userId: "learner@example.com",
        regradingStatus: RegradingStatus.PENDING,
        assignment: { name: "Test Assignment" },
      };

      it("should reject request when author owns the assignment", async () => {
        mockPrismaService.regradingRequest.findUnique.mockResolvedValue(
          mockRequest,
        );
        mockPrismaService.assignmentAuthor.findFirst.mockResolvedValue({
          assignmentId: 10,
          userId: "author@example.com",
        });
        mockPrismaService.regradingRequest.update.mockResolvedValue({
          ...mockRequest,
          regradingStatus: RegradingStatus.REJECTED,
          regradingReason: "Grading is correct",
        });

        const result = await service.rejectAuthorRegradingRequest(
          1,
          "Grading is correct",
          "author@example.com",
        );

        expect(result).toEqual({ success: true });
        expect(mockPrismaService.regradingRequest.update).toHaveBeenCalledWith({
          where: { id: 1 },
          data: {
            regradingStatus: "REJECTED",
            regradingReason: "Grading is correct",
            processedBy: "author@example.com",
          },
        });
      });

      it("should throw NotFoundException when request not found", async () => {
        mockPrismaService.regradingRequest.findUnique.mockResolvedValue(null);

        await expect(
          service.rejectAuthorRegradingRequest(
            999,
            "Not valid",
            "author@example.com",
          ),
        ).rejects.toThrow(NotFoundException);
      });

      it("should throw NotFoundException when author does not own assignment", async () => {
        mockPrismaService.regradingRequest.findUnique.mockResolvedValue(
          mockRequest,
        );
        mockPrismaService.assignmentAuthor.findFirst.mockResolvedValue(null);

        await expect(
          service.rejectAuthorRegradingRequest(
            1,
            "Not valid",
            "different@example.com",
          ),
        ).rejects.toThrow(
          new NotFoundException(
            "You do not have permission to manage this regrading request",
          ),
        );
      });
    });
  });
});
