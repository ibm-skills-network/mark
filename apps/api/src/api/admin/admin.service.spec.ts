import { NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { AssignmentType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { PrismaService } from "../../database/prisma.service";
import { AssignmentServiceV2 } from "../assignment/v2/services/assignment.service";
import { AssignmentFileService } from "../assignment/v2/services/assignment-file.service";
import { JobStatusServiceV2 } from "../assignment/v2/services/job-status.service";
import { QuestionService } from "../assignment/v2/services/question.service";
import { AssignmentTypeEnum } from "../llm/features/question-generation/services/question-generation.service";
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
  let mockAssignmentFileService: {
    abortAssignmentFileUpload: jest.Mock;
    cleanupAssignmentFileObjects: jest.Mock;
    completeAssignmentFileUpload: jest.Mock;
    deleteAssignmentFile: jest.Mock;
    getAssignmentFiles: jest.Mock;
    initiateAssignmentFileUploads: jest.Mock;
  };
  let mockQuestionService: { generateQuestions: jest.Mock };
  let mockJobStatusService: { getJobStatus: jest.Mock };

  beforeEach(async () => {
    mockPrisma = makeMockPrisma();
    mockAssignmentFileService = {
      abortAssignmentFileUpload: jest.fn().mockResolvedValue(undefined),
      cleanupAssignmentFileObjects: jest.fn().mockResolvedValue(undefined),
      completeAssignmentFileUpload: jest.fn().mockResolvedValue({ id: 7 }),
      deleteAssignmentFile: jest.fn().mockResolvedValue(undefined),
      getAssignmentFiles: jest.fn().mockResolvedValue({ files: [] }),
      initiateAssignmentFileUploads: jest
        .fn()
        .mockResolvedValue({ uploads: [{ fileId: 7 }] }),
    };
    mockQuestionService = {
      generateQuestions: jest
        .fn()
        .mockResolvedValue({
          message: "Question generation started",
          jobId: "job-1",
        }),
    };
    mockJobStatusService = {
      getJobStatus: jest.fn(),
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
        {
          provide: QuestionService,
          useValue: mockQuestionService,
        },
        {
          provide: JobStatusServiceV2,
          useValue: mockJobStatusService,
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

  describe("admin assignment file wrappers", () => {
    it("checks that the assignment exists before initiating uploads", async () => {
      await service.initiateAssignmentFileUploads(
        1,
        {
          files: [
            {
              fileName: "slides.pdf",
              mimeType: "application/pdf",
              fileSize: 1024,
            },
          ],
        },
        "service-account",
      );

      expect(mockPrisma.assignment.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        select: { id: true },
      });
      expect(
        mockAssignmentFileService.initiateAssignmentFileUploads,
      ).toHaveBeenCalledWith(
        1,
        {
          files: [
            {
              fileName: "slides.pdf",
              mimeType: "application/pdf",
              fileSize: 1024,
            },
          ],
        },
        "service-account",
      );
    });

    it("404s file operations when the assignment is missing", async () => {
      mockPrisma.assignment.findUnique.mockResolvedValueOnce(null);

      await expect(service.getAssignmentFiles(404)).rejects.toThrow(
        NotFoundException,
      );
      expect(
        mockAssignmentFileService.getAssignmentFiles,
      ).not.toHaveBeenCalled();
    });

    it("passes complete requests through after validating assignment existence", async () => {
      const dto = {
        uploadId: "upload-1",
        parts: [{ partNumber: 1, etag: "etag-1" }],
      };

      await service.completeAssignmentFileUpload(1, 7, dto);

      expect(
        mockAssignmentFileService.completeAssignmentFileUpload,
      ).toHaveBeenCalledWith(1, 7, dto);
    });

    it("passes abort requests through after validating assignment existence", async () => {
      await service.abortAssignmentFileUpload(1, 7);

      expect(
        mockAssignmentFileService.abortAssignmentFileUpload,
      ).toHaveBeenCalledWith(1, 7);
    });

    it("passes delete requests through after validating assignment existence", async () => {
      await service.deleteAssignmentFile(1, 7);

      expect(
        mockAssignmentFileService.deleteAssignmentFile,
      ).toHaveBeenCalledWith(1, 7);
    });
  });

  describe("generateQuestions", () => {
    it("normalizes the payload assignmentId to the route assignment ID", async () => {
      await service.generateQuestions(
        9,
        {
          assignmentId: 123,
          assignmentType: AssignmentTypeEnum.QUIZ,
          questionsToGenerate: {
            multipleChoice: 1,
            multipleSelect: 0,
            textResponse: 0,
            trueFalse: 0,
            multipleChoiceSubtypes: {
              scenario: 1,
            },
          },
          contentSource: "stored",
        },
        "service-account",
      );

      expect(mockQuestionService.generateQuestions).toHaveBeenCalledWith(
        9,
        expect.objectContaining({
          assignmentId: 9,
          contentSource: "stored",
        }),
        "service-account",
      );
    });
  });

  describe("getQuestionGenerationJobStatus", () => {
    it("returns completed job results", async () => {
      mockJobStatusService.getJobStatus.mockResolvedValue({
        id: "job-1",
        queueName: "assignment-v2",
        jobName: "generate-questions",
        kind: "assignment-question-generation",
        userId: "service-account",
        status: "Completed",
        progress: "done",
        result: [{ id: 1 }],
        createdAt: "2026-05-15T12:00:00.000Z",
        updatedAt: "2026-05-15T12:00:00.000Z",
      });

      await expect(
        service.getQuestionGenerationJobStatus("job-1"),
      ).resolves.toEqual({
        status: "Completed",
        progress: "done",
        questions: [{ id: 1 }],
      });
    });

    it("404s when the job does not exist", async () => {
      mockJobStatusService.getJobStatus.mockResolvedValue(null);

      await expect(
        service.getQuestionGenerationJobStatus("missing-job"),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
