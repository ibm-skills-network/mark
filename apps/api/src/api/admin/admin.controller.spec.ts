import { Test, TestingModule } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { AdminVerificationService } from "../../auth/services/admin-verification.service";
import { PrismaService } from "../../database/prisma.service";
import { AssignmentServiceV2 } from "../assignment/v2/services/assignment.service";
import { AssignmentFileService } from "../assignment/v2/services/assignment-file.service";
import { LLM_PRICING_SERVICE } from "../llm/llm.constants";
import { AdminController } from "./admin.controller";
import { AdminRepository } from "./admin.repository";
import { AdminService } from "./admin.service";

const mockLogger = {
  child: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
};

describe("AdminController", () => {
  let controller: AdminController;
  const originalDatabaseUrl = process.env.DATABASE_URL;

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
    const mockLlmPricingService = {
      calculateCost: jest.fn().mockReturnValue(0.01),
      getTokenCount: jest.fn().mockReturnValue(100),
    };

    const mockAdminVerificationService = {
      generateAndStoreCode: jest.fn().mockResolvedValue("123456"),
      verifyCode: jest.fn().mockResolvedValue(true),
      verifyAdminSession: jest
        .fn()
        .mockResolvedValue({ email: "admin@test.com", role: "admin" }),
      createAdminSession: jest.fn().mockResolvedValue("mock-session-token"),
      revokeSession: jest.fn().mockResolvedValue(true),
      isAdminSessionValid: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        AdminService,
        PrismaService,
        AdminRepository,
        {
          provide: AssignmentServiceV2,
          useValue: {
            publishAssignment: jest.fn(),
          },
        },
        {
          provide: AssignmentFileService,
          useValue: {
            cleanupAssignmentFileObjects: jest.fn(),
          },
        },
        { provide: LLM_PRICING_SERVICE, useValue: mockLlmPricingService },
        {
          provide: AdminVerificationService,
          useValue: mockAdminVerificationService,
        },
        { provide: WINSTON_MODULE_PROVIDER, useValue: mockLogger },
      ],
    }).compile();

    controller = module.get<AdminController>(AdminController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });
});
