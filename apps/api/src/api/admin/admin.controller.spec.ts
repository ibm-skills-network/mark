import { Test, TestingModule } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { AdminVerificationService } from "../../auth/services/admin-verification.service";
import { PrismaService } from "../../database/prisma.service";
import { AssignmentServiceV2 } from "../assignment/v2/services/assignment.service";
import { AssignmentFileService } from "../assignment/v2/services/assignment-file.service";
import { JobStatusServiceV2 } from "../assignment/v2/services/job-status.service";
import { QuestionService } from "../assignment/v2/services/question.service";
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
  let adminService: AdminService;
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
            abortAssignmentFileUpload: jest.fn(),
            cleanupAssignmentFileObjects: jest.fn(),
            completeAssignmentFileUpload: jest.fn(),
            deleteAssignmentFile: jest.fn(),
            getAssignmentFiles: jest.fn(),
            initiateAssignmentFileUploads: jest.fn(),
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
        { provide: LLM_PRICING_SERVICE, useValue: mockLlmPricingService },
        {
          provide: AdminVerificationService,
          useValue: mockAdminVerificationService,
        },
        { provide: WINSTON_MODULE_PROVIDER, useValue: mockLogger },
      ],
    }).compile();

    controller = module.get<AdminController>(AdminController);
    adminService = module.get<AdminService>(AdminService);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  it("uses the forwarded user-session header as the actor identity", async () => {
    jest
      .spyOn(adminService, "generateQuestions")
      .mockResolvedValue({ message: "started", jobId: "job-1" });

    await controller.generateQuestions(
      12,
      {
        assignmentId: 12,
        assignmentType: 0,
        questionsToGenerate: {
          multipleChoice: 1,
          multipleSelect: 0,
          textResponse: 0,
          trueFalse: 0,
        },
      },
      {
        headers: {
          "user-session": JSON.stringify({
            userId: "context-manager@skills.network",
          }),
        },
      } as any,
    );

    expect(adminService.generateQuestions).toHaveBeenCalledWith(
      12,
      expect.any(Object),
      "context-manager@skills.network",
    );
  });

  it("falls back to admin-api when no forwarded session identity is present", async () => {
    jest
      .spyOn(adminService, "generateQuestions")
      .mockResolvedValue({ message: "started", jobId: "job-2" });

    await controller.generateQuestions(
      9,
      {
        assignmentId: 9,
        assignmentType: 0,
        questionsToGenerate: {
          multipleChoice: 1,
          multipleSelect: 0,
          textResponse: 0,
          trueFalse: 0,
        },
      },
      {
        headers: {},
      } as any,
    );

    expect(adminService.generateQuestions).toHaveBeenCalledWith(
      9,
      expect.any(Object),
      "admin-api",
    );
  });

  it("falls back to admin-api when the forwarded user-session header is unparseable", async () => {
    jest
      .spyOn(adminService, "generateQuestions")
      .mockResolvedValue({ message: "started", jobId: "job-3" });

    await controller.generateQuestions(
      4,
      {
        assignmentId: 4,
        assignmentType: 0,
        questionsToGenerate: {
          multipleChoice: 1,
          multipleSelect: 0,
          textResponse: 0,
          trueFalse: 0,
        },
      },
      {
        method: "POST",
        originalUrl: "/v1/admin/assignments/4/generate-questions",
        get: () => undefined,
        headers: {
          "user-session": "{not-json",
        },
      } as any,
    );

    expect(adminService.generateQuestions).toHaveBeenCalledWith(
      4,
      expect.any(Object),
      "admin-api",
    );
  });

  it("falls back to admin-api when the forwarded user-session payload is not an object", async () => {
    jest
      .spyOn(adminService, "generateQuestions")
      .mockResolvedValue({ message: "started", jobId: "job-4" });

    await controller.generateQuestions(
      5,
      {
        assignmentId: 5,
        assignmentType: 0,
        questionsToGenerate: {
          multipleChoice: 1,
          multipleSelect: 0,
          textResponse: 0,
          trueFalse: 0,
        },
      },
      {
        headers: {
          "user-session": "null",
        },
      } as any,
    );

    expect(adminService.generateQuestions).toHaveBeenCalledWith(
      5,
      expect.any(Object),
      "admin-api",
    );
  });
});
