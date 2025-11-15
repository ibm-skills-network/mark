import { Test, TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { RegradingStatus } from "@prisma/client";
import { AttemptRegradingService } from "../attempt-regrading.service";
import { PrismaService } from "../../../../database/prisma.service";
import { EmailService } from "../../../../common/services/email.service";
import { UserRole } from "../../../../auth/interfaces/user.session.interface";

describe("AttemptRegradingService", () => {
  let service: AttemptRegradingService;
  let prismaService: PrismaService;
  let emailService: EmailService;

  const mockPrismaService = {
    assignmentAttempt: {
      findUnique: jest.fn(),
    },
    regradingRequest: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    assignment: {
      findUnique: jest.fn(),
    },
    assignmentAuthor: {
      findMany: jest.fn(),
    },
    authorSettings: {
      findMany: jest.fn(),
    },
  };

  const mockEmailService = {
    sendRegradingRequestNotification: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttemptRegradingService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: EmailService, useValue: mockEmailService },
      ],
    }).compile();

    service = module.get<AttemptRegradingService>(AttemptRegradingService);
    prismaService = module.get<PrismaService>(PrismaService);
    emailService = module.get<EmailService>(EmailService);

    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("processRegradingRequest", () => {
    const mockUserSession = {
      userId: "learner@example.com",
      role: UserRole.LEARNER,
      assignmentId: 1,
      groupId: "group-1",
    };

    const mockAssignmentAttempt = {
      id: 1,
      assignmentId: 1,
      userId: "learner@example.com",
      grade: 0.5,
      submitted: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(),
    };

    const mockAssignment = {
      id: 1,
      name: "Test Assignment",
    };

    const mockAssignmentAuthors = [
      { userId: "author1@example.com" },
      { userId: "author2@example.com" },
    ];

    const mockRegradingRequestDto = {
      assignmentId: 1,
      userId: "learner@example.com",
      attemptId: 1,
      reason: "I believe my answer was correct",
      proposedGrade: 80,
      questionIds: [1, 2],
    };

    it("should create a new regrading request when none exists", async () => {
      mockPrismaService.assignmentAttempt.findUnique.mockResolvedValue(
        mockAssignmentAttempt,
      );
      mockPrismaService.regradingRequest.findFirst.mockResolvedValue(null);
      mockPrismaService.regradingRequest.create.mockResolvedValue({
        id: 1,
        ...mockRegradingRequestDto,
        regradingStatus: RegradingStatus.PENDING,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrismaService.assignment.findUnique.mockResolvedValue(mockAssignment);
      mockPrismaService.assignmentAuthor.findMany.mockResolvedValue(
        mockAssignmentAuthors,
      );
      mockPrismaService.authorSettings.findMany.mockResolvedValue([]);
      mockEmailService.sendRegradingRequestNotification.mockResolvedValue();

      const result = await service.processRegradingRequest(
        1,
        1,
        mockRegradingRequestDto,
        mockUserSession,
      );

      expect(result).toEqual({ success: true, id: 1 });
      expect(mockPrismaService.regradingRequest.create).toHaveBeenCalledWith({
        data: {
          assignmentId: 1,
          attemptId: 1,
          userId: "learner@example.com",
          regradingReason: "I believe my answer was correct",
          proposedGrade: 80,
          questionIds: [1, 2],
          regradingStatus: RegradingStatus.PENDING,
        },
      });
      expect(
        mockEmailService.sendRegradingRequestNotification,
      ).toHaveBeenCalledWith(
        ["author1@example.com", "author2@example.com"],
        "learner@example.com",
        "Test Assignment",
        1,
        1,
        1,
        "I believe my answer was correct",
        0.5,
        80,
        [1, 2],
      );
    });

    it("should update existing regrading request", async () => {
      const existingRequest = {
        id: 2,
        assignmentId: 1,
        attemptId: 1,
        userId: "learner@example.com",
        regradingReason: "Old reason",
        proposedGrade: 70,
        questionIds: [1],
        regradingStatus: RegradingStatus.REJECTED,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.assignmentAttempt.findUnique.mockResolvedValue(
        mockAssignmentAttempt,
      );
      mockPrismaService.regradingRequest.findFirst.mockResolvedValue(
        existingRequest,
      );
      mockPrismaService.regradingRequest.update.mockResolvedValue({
        ...existingRequest,
        regradingReason: "I believe my answer was correct",
        proposedGrade: 80,
        questionIds: [1, 2],
        regradingStatus: RegradingStatus.PENDING,
        updatedAt: new Date(),
      });
      mockPrismaService.assignment.findUnique.mockResolvedValue(mockAssignment);
      mockPrismaService.assignmentAuthor.findMany.mockResolvedValue(
        mockAssignmentAuthors,
      );
      mockPrismaService.authorSettings.findMany.mockResolvedValue([]);
      mockEmailService.sendRegradingRequestNotification.mockResolvedValue();

      const result = await service.processRegradingRequest(
        1,
        1,
        mockRegradingRequestDto,
        mockUserSession,
      );

      expect(result).toEqual({ success: true, id: 2 });
      expect(mockPrismaService.regradingRequest.update).toHaveBeenCalledWith({
        where: { id: 2 },
        data: {
          regradingReason: "I believe my answer was correct",
          proposedGrade: 80,
          questionIds: [1, 2],
          regradingStatus: RegradingStatus.PENDING,
          updatedAt: expect.any(Date) as Date,
        },
      });
      expect(
        mockEmailService.sendRegradingRequestNotification,
      ).toHaveBeenCalled();
    });

    it("should handle multiple question IDs correctly", async () => {
      mockPrismaService.assignmentAttempt.findUnique.mockResolvedValue(
        mockAssignmentAttempt,
      );
      mockPrismaService.regradingRequest.findFirst.mockResolvedValue(null);
      mockPrismaService.regradingRequest.create.mockResolvedValue({
        id: 1,
        ...mockRegradingRequestDto,
        questionIds: [1, 2, 3, 4],
        regradingStatus: RegradingStatus.PENDING,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrismaService.assignment.findUnique.mockResolvedValue(mockAssignment);
      mockPrismaService.assignmentAuthor.findMany.mockResolvedValue(
        mockAssignmentAuthors,
      );
      mockPrismaService.authorSettings.findMany.mockResolvedValue([]);
      mockEmailService.sendRegradingRequestNotification.mockResolvedValue();

      const multiQuestionDto = {
        ...mockRegradingRequestDto,
        questionIds: [1, 2, 3, 4],
      };

      await service.processRegradingRequest(
        1,
        1,
        multiQuestionDto,
        mockUserSession,
      );

      expect(mockPrismaService.regradingRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            questionIds: [1, 2, 3, 4],
          }) as Record<string, unknown>,
        }) as Record<string, unknown>,
      );

      expect(
        mockEmailService.sendRegradingRequestNotification,
      ).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(String),
        expect.any(String),
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        expect.any(String),
        expect.any(Number),
        expect.any(Number),
        [1, 2, 3, 4],
      );
    });

    it("should throw NotFoundException when attempt does not exist", async () => {
      mockPrismaService.assignmentAttempt.findUnique.mockResolvedValue(null);

      await expect(
        service.processRegradingRequest(
          1,
          1,
          mockRegradingRequestDto,
          mockUserSession,
        ),
      ).rejects.toThrow(
        new NotFoundException("Assignment attempt with ID 1 not found."),
      );
    });

    it("should throw BadRequestException when assignment ID does not match", async () => {
      mockPrismaService.assignmentAttempt.findUnique.mockResolvedValue({
        ...mockAssignmentAttempt,
        assignmentId: 999,
      });

      await expect(
        service.processRegradingRequest(
          1,
          1,
          mockRegradingRequestDto,
          mockUserSession,
        ),
      ).rejects.toThrow(
        new BadRequestException("Assignment ID does not match the attempt."),
      );
    });

    it("should throw ForbiddenException when user does not own the attempt", async () => {
      mockPrismaService.assignmentAttempt.findUnique.mockResolvedValue({
        ...mockAssignmentAttempt,
        userId: "different-user@example.com",
      });

      await expect(
        service.processRegradingRequest(
          1,
          1,
          mockRegradingRequestDto,
          mockUserSession,
        ),
      ).rejects.toThrow(
        new ForbiddenException(
          "You do not have permission to request regrading for this attempt.",
        ),
      );
    });

    it("should handle email notification failures gracefully", async () => {
      mockPrismaService.assignmentAttempt.findUnique.mockResolvedValue(
        mockAssignmentAttempt,
      );
      mockPrismaService.regradingRequest.findFirst.mockResolvedValue(null);
      mockPrismaService.regradingRequest.create.mockResolvedValue({
        id: 1,
        ...mockRegradingRequestDto,
        regradingStatus: RegradingStatus.PENDING,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrismaService.assignment.findUnique.mockResolvedValue(mockAssignment);
      mockPrismaService.assignmentAuthor.findMany.mockResolvedValue(
        mockAssignmentAuthors,
      );
      mockEmailService.sendRegradingRequestNotification.mockRejectedValue(
        new Error("Email service error"),
      );

      const result = await service.processRegradingRequest(
        1,
        1,
        mockRegradingRequestDto,
        mockUserSession,
      );

      expect(result).toEqual({ success: true, id: 1 });
    });

    it("should handle empty question IDs array", async () => {
      mockPrismaService.assignmentAttempt.findUnique.mockResolvedValue(
        mockAssignmentAttempt,
      );
      mockPrismaService.regradingRequest.findFirst.mockResolvedValue(null);
      mockPrismaService.regradingRequest.create.mockResolvedValue({
        id: 1,
        ...mockRegradingRequestDto,
        questionIds: [],
        regradingStatus: RegradingStatus.PENDING,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrismaService.assignment.findUnique.mockResolvedValue(mockAssignment);
      mockPrismaService.assignmentAuthor.findMany.mockResolvedValue(
        mockAssignmentAuthors,
      );
      mockPrismaService.authorSettings.findMany.mockResolvedValue([]);
      mockEmailService.sendRegradingRequestNotification.mockResolvedValue();

      const emptyQuestionDto = {
        ...mockRegradingRequestDto,
        questionIds: undefined,
      };

      await service.processRegradingRequest(
        1,
        1,
        emptyQuestionDto,
        mockUserSession,
      );

      expect(mockPrismaService.regradingRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            questionIds: [],
          }) as Record<string, unknown>,
        }) as Record<string, unknown>,
      );
    });

    it("should handle assignment with no authors", async () => {
      mockPrismaService.assignmentAttempt.findUnique.mockResolvedValue(
        mockAssignmentAttempt,
      );
      mockPrismaService.regradingRequest.findFirst.mockResolvedValue(null);
      mockPrismaService.regradingRequest.create.mockResolvedValue({
        id: 1,
        ...mockRegradingRequestDto,
        regradingStatus: RegradingStatus.PENDING,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrismaService.assignment.findUnique.mockResolvedValue(mockAssignment);
      mockPrismaService.assignmentAuthor.findMany.mockResolvedValue([]);

      const result = await service.processRegradingRequest(
        1,
        1,
        mockRegradingRequestDto,
        mockUserSession,
      );

      expect(result).toEqual({ success: true, id: 1 });
      expect(
        mockEmailService.sendRegradingRequestNotification,
      ).not.toHaveBeenCalled();
    });
  });

  describe("getRegradingStatus", () => {
    const mockUserSession = {
      userId: "learner@example.com",
      role: UserRole.LEARNER,
      assignmentId: 1,
      groupId: "group-1",
    };

    it("should return regrading status when request exists", async () => {
      const mockRequest = {
        id: 1,
        assignmentId: 1,
        attemptId: 1,
        userId: "learner@example.com",
        regradingStatus: RegradingStatus.APPROVED,
        regradingReason: "Valid concern",
        proposedGrade: 80,
        questionIds: [1, 2],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.regradingRequest.findFirst.mockResolvedValue(
        mockRequest,
      );

      const result = await service.getRegradingStatus(1, 1, mockUserSession);

      expect(result).toEqual({ status: RegradingStatus.APPROVED });
      expect(mockPrismaService.regradingRequest.findFirst).toHaveBeenCalledWith(
        {
          where: {
            assignmentId: 1,
            attemptId: 1,
            userId: "learner@example.com",
          },
        },
      );
    });

    it("should throw NotFoundException when request does not exist", async () => {
      mockPrismaService.regradingRequest.findFirst.mockResolvedValue(null);

      await expect(
        service.getRegradingStatus(1, 1, mockUserSession),
      ).rejects.toThrow(
        new NotFoundException(
          "Regrading request for assignment 1 and attempt 1 not found.",
        ),
      );
    });

    it("should return PENDING status", async () => {
      mockPrismaService.regradingRequest.findFirst.mockResolvedValue({
        id: 1,
        regradingStatus: RegradingStatus.PENDING,
        assignmentId: 1,
        attemptId: 1,
        userId: "learner@example.com",
        regradingReason: "Reason",
        proposedGrade: null,
        questionIds: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.getRegradingStatus(1, 1, mockUserSession);

      expect(result).toEqual({ status: RegradingStatus.PENDING });
    });

    it("should return REJECTED status", async () => {
      mockPrismaService.regradingRequest.findFirst.mockResolvedValue({
        id: 1,
        regradingStatus: RegradingStatus.REJECTED,
        assignmentId: 1,
        attemptId: 1,
        userId: "learner@example.com",
        regradingReason: "Reason",
        proposedGrade: null,
        questionIds: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.getRegradingStatus(1, 1, mockUserSession);

      expect(result).toEqual({ status: RegradingStatus.REJECTED });
    });

    it("should return COMPLETED status", async () => {
      mockPrismaService.regradingRequest.findFirst.mockResolvedValue({
        id: 1,
        regradingStatus: RegradingStatus.COMPLETED,
        assignmentId: 1,
        attemptId: 1,
        userId: "learner@example.com",
        regradingReason: "Reason",
        proposedGrade: null,
        questionIds: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.getRegradingStatus(1, 1, mockUserSession);

      expect(result).toEqual({ status: RegradingStatus.COMPLETED });
    });
  });
});
