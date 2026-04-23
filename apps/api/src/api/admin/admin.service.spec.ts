import { NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { AssignmentType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { PrismaService } from "../../database/prisma.service";
import { AssignmentServiceV2 } from "../assignment/v2/services/assignment.service";
import { AssignmentFileService } from "../assignment/v2/services/assignment-file.service";
import { LLM_PRICING_SERVICE } from "../llm/llm.constants";
import { AdminService } from "./admin.service";

const mockLogger = {
  child: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
};

const noopDeleteMany = jest.fn().mockResolvedValue({ count: 0 });

const makeMockPrisma = () => ({
  questionResponse: { deleteMany: noopDeleteMany },
  assignmentAttemptQuestionVariant: { deleteMany: noopDeleteMany },
  assignmentAttempt: { deleteMany: noopDeleteMany },
  assignmentGroup: { deleteMany: noopDeleteMany },
  assignmentFeedback: { deleteMany: noopDeleteMany },
  regradingRequest: { deleteMany: noopDeleteMany },
  report: { deleteMany: noopDeleteMany },
  assignmentTranslation: { deleteMany: noopDeleteMany },
  aIUsage: { deleteMany: noopDeleteMany },
  question: { deleteMany: noopDeleteMany },
  assignment: {
    findUnique: jest.fn().mockResolvedValue({
      id: 1,
      name: "Test Assignment",
      type: AssignmentType.AI_GRADED,
    }),
    delete: jest.fn().mockResolvedValue(undefined),
  },
});

describe("AdminService", () => {
  let service: AdminService;
  let mockPrisma: ReturnType<typeof makeMockPrisma>;
  let mockAssignmentFileService: { cleanupAssignmentFileObjects: jest.Mock };

  beforeEach(async () => {
    mockPrisma = makeMockPrisma();
    mockAssignmentFileService = {
      cleanupAssignmentFileObjects: jest.fn().mockResolvedValue(undefined),
    };

    const mockLlmPricingService = {
      calculateCost: jest.fn().mockReturnValue(0.01),
      getTokenCount: jest.fn().mockReturnValue(100),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: AssignmentServiceV2,
          useValue: { publishAssignment: jest.fn() },
        },
        {
          provide: AssignmentFileService,
          useValue: mockAssignmentFileService,
        },
        { provide: LLM_PRICING_SERVICE, useValue: mockLlmPricingService },
        { provide: WINSTON_MODULE_PROVIDER, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("removeAssignment", () => {
    it("throws NotFoundException when assignment does not exist", async () => {
      mockPrisma.assignment.findUnique.mockResolvedValue(null);

      await expect(service.removeAssignment(99)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("calls cleanupAssignmentFileObjects BEFORE prisma.assignment.delete", async () => {
      const callOrder: string[] = [];

      mockAssignmentFileService.cleanupAssignmentFileObjects.mockImplementation(
        async () => {
          callOrder.push("cleanup");
        },
      );
      mockPrisma.assignment.delete.mockImplementation(async () => {
        callOrder.push("delete");
      });

      await service.removeAssignment(1);

      expect(callOrder).toEqual(["cleanup", "delete"]);
    });

    it("returns assignment metadata on success", async () => {
      const result = await service.removeAssignment(1);

      expect(result).toMatchObject({
        id: 1,
        success: true,
        name: "Test Assignment",
      });
    });
  });
});
