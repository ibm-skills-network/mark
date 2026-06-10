import { NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { AssignmentType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { PrismaService } from "../../database/prisma.service";
import { AssignmentServiceV2 } from "../assignment/v2/services/assignment.service";
import { AssignmentFileService } from "../assignment/v2/services/assignment-file.service";
import { JobStatusServiceV2 } from "../assignment/v2/services/job-status.service";
import { QuestionService } from "../assignment/v2/services/question.service";
import {
  UserRole,
  type UserSession,
} from "../../auth/interfaces/user.session.interface";
import { AssignmentTypeEnum } from "../llm/features/question-generation/services/question-generation.service";
import { LLM_PRICING_SERVICE } from "../llm/llm.constants";
import {
  UserRole,
  UserSession,
} from "../../auth/interfaces/user.session.interface";
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
  assignmentAttempt: {
    deleteMany: noopDeleteMany,
    groupBy: jest.fn().mockResolvedValue([]),
    findMany: jest.fn().mockResolvedValue([]),
  },
  assignmentGroup: { deleteMany: noopDeleteMany },
  assignmentFeedback: {
    deleteMany: noopDeleteMany,
    groupBy: jest.fn().mockResolvedValue([]),
    aggregate: jest
      .fn()
      .mockResolvedValue({ _avg: { assignmentRating: null } }),
  },
  regradingRequest: { deleteMany: noopDeleteMany },
  report: { deleteMany: noopDeleteMany },
  assignmentTranslation: { deleteMany: noopDeleteMany },
  aIUsage: {
    deleteMany: noopDeleteMany,
    findMany: jest.fn().mockResolvedValue([]),
  },
  question: { deleteMany: noopDeleteMany },
  assignment: {
    findUnique: jest.fn().mockResolvedValue({
      id: 1,
      name: "Test Assignment",
      type: AssignmentType.AI_GRADED,
    }),
    delete: jest.fn().mockResolvedValue(undefined),
    count: jest.fn().mockResolvedValue(0),
    findMany: jest.fn().mockResolvedValue([]),
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
  let mockAssignmentService: { publishAssignment: jest.Mock };
  let mockQuestionService: { generateQuestions: jest.Mock };
  let mockJobStatusService: { getJobStatus: jest.Mock };
  let mockLlmPricingService: {
    calculateCost: jest.Mock;
    getTokenCount: jest.Mock;
    calculateCostWithBreakdown: jest.Mock;
  };

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
    mockAssignmentService = {
      publishAssignment: jest
        .fn()
        .mockResolvedValue({ message: "Publishing started", jobId: "job-2" }),
    };
    mockQuestionService = {
      generateQuestions: jest.fn().mockResolvedValue({
        message: "Question generation started",
        jobId: "job-1",
      }),
    };
    mockJobStatusService = {
      getJobStatus: jest.fn(),
    };

    mockLlmPricingService = {
      calculateCost: jest.fn().mockReturnValue(0.01),
      getTokenCount: jest.fn().mockReturnValue(100),
      calculateCostBatch: jest.fn().mockResolvedValue([]),
      calculateCostWithBreakdown: jest.fn().mockResolvedValue({
        totalCost: 0.01,
        inputCost: 0.005,
        outputCost: 0.005,
        inputTokenPrice: 0.000_001,
        outputTokenPrice: 0.000_002,
        pricingEffectiveDate: new Date(),
        modelKey: "gpt-4o",
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: AssignmentServiceV2,
          useValue: mockAssignmentService,
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

  describe("getAssignmentAnalytics (connection-pool guard)", () => {
    const adminSession = {
      role: UserRole.ADMIN,
      userId: "admin@ibm.com",
    } as unknown as UserSession;

    beforeEach(() => {
      mockPrisma.assignment.count = jest.fn().mockResolvedValue(500);
      mockPrisma.assignment.findMany = jest.fn().mockResolvedValue([
        { id: 1, name: "A1", published: true, updatedAt: new Date() },
        { id: 2, name: "A2", published: false, updatedAt: new Date() },
      ]);
      // One mock for all three assignmentAttempt.groupBy calls; branch on args
      // so the call order doesn't matter.
      mockPrisma.assignmentAttempt.groupBy = jest.fn((args: any) => {
        if (args.by?.includes("userId")) {
          // distinct (assignmentId, userId) pairs — assignment 1 has 2 learners,
          // assignment 2 has 1.
          return Promise.resolve([
            { assignmentId: 1, userId: "u1" },
            { assignmentId: 1, userId: "u2" },
            { assignmentId: 2, userId: "u1" },
          ]);
        }
        if (args.where?.submitted) {
          return Promise.resolve([
            { assignmentId: 1, _count: { id: 5 }, _avg: { grade: 0.8 } },
          ]);
        }
        return Promise.resolve([
          { assignmentId: 1, _count: { id: 10 } },
          { assignmentId: 2, _count: { id: 3 } },
        ]);
      });
      mockPrisma.assignmentFeedback.groupBy = jest
        .fn()
        .mockResolvedValue([
          { assignmentId: 1, _avg: { assignmentRating: 4 } },
        ]);
      mockPrisma.aIUsage.findMany = jest.fn().mockResolvedValue([]);
    });

    // NOTE: #527's service-level page-size clamp was dropped in favour of the
    // authoritative controller cap (MAX_LIMIT=25, which 400s oversized limits).
    // That behaviour is covered by the controller spec; there is no service
    // clamp to test here anymore.

    it("derives unique learners with ONE grouped query, not one per assignment", async () => {
      await service.getAssignmentAnalytics(adminSession, 1, 1000);

      const pairCalls = (
        mockPrisma.assignmentAttempt.groupBy as jest.Mock
      ).mock.calls.filter(([args]) => args.by?.includes("userId"));
      expect(pairCalls).toHaveLength(1);
    });

    it("batches AI usage into batched queries (page + full-set), never per-assignment", async () => {
      await service.getAssignmentAnalytics(adminSession, 1, 1000);

      // Two batched scans, each with an `in` filter — one for the page, one for
      // the filter-wide aggregates — instead of one findMany per assignment.
      expect(mockPrisma.aIUsage.findMany).toHaveBeenCalledTimes(2);
      expect(mockPrisma.aIUsage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { assignmentId: { in: [1, 2] } },
        }),
      );
    });

    it("returns the correct per-assignment unique-learner counts", async () => {
      const result = await service.getAssignmentAnalytics(
        adminSession,
        1,
        1000,
      );

      const a1 = result.data.find((d) => d.id === 1);
      const a2 = result.data.find((d) => d.id === 2);
      expect(a1?.uniqueLearners).toBe(2);
      expect(a2?.uniqueLearners).toBe(1);
    });

    it("bounds how many assignment cost chains hit pricing lookups concurrently", async () => {
      const ids = [1, 2, 3, 4, 5, 6];
      // Return the page rows for the paged query (has `take`), but no rows for
      // the id-only aggregate query — that isolates this test to the per-page
      // cost chains (the limiter's job), excluding the single full-set aggregate
      // cost call which runs outside the limiter.
      mockPrisma.assignment.findMany = jest.fn((args: any) =>
        Promise.resolve(
          args?.take === undefined
            ? []
            : ids.map((id) => ({
                id,
                name: `A${id}`,
                published: true,
                updatedAt: new Date(),
              })),
        ),
      );
      // Every assignment has AI usage, so each cost chain calls pricing.
      mockPrisma.aIUsage.findMany = jest.fn().mockResolvedValue(
        ids.map((assignmentId) => ({
          assignmentId,
          tokensIn: 10,
          tokensOut: 5,
          createdAt: new Date(),
          usageType: "grading",
          modelKey: "gpt-4o",
        })),
      );

      let active = 0;
      let maxActive = 0;
      // Cost now flows through the batched pricing call (one per assignment's
      // cost chain); the limiter caps how many run at once.
      mockLlmPricingService.calculateCostBatch.mockImplementation(
        async (records: Array<unknown>) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          // Yield so concurrent chains overlap inside the limiter.
          await new Promise((resolve) => setImmediate(resolve));
          active -= 1;
          return records.map(() => ({
            inputTokens: 10,
            outputTokens: 5,
            inputCost: 0.005,
            outputCost: 0.005,
            totalCost: 0.01,
            modelKey: "gpt-4o",
            pricingEffectiveDate: new Date(),
            inputTokenPrice: 0.000_001,
            outputTokenPrice: 0.000_002,
          }));
        },
      );

      await service.getAssignmentAnalytics(adminSession, 1, 1000);

      // Pricing was exercised, but never more than the cost-calc cap at once.
      expect(maxActive).toBeGreaterThan(0);
      expect(maxActive).toBeLessThanOrEqual(4);
    });
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

  describe("publishAssignment", () => {
    it("validates the assignment exists and delegates to the v2 publish service", async () => {
      const payload = {
        questions: [],
        published: false,
        versionDescription: "Admin publish",
      } as any;

      await expect(
        service.publishAssignment(9, payload, "service-account"),
      ).resolves.toEqual({
        message: "Publishing started",
        jobId: "job-2",
      });

      expect(mockPrisma.assignment.findUnique).toHaveBeenCalledWith({
        where: { id: 9 },
        select: { id: true },
      });
      expect(mockAssignmentService.publishAssignment).toHaveBeenCalledWith(
        9,
        expect.objectContaining({
          published: true,
          versionDescription: "Admin publish",
        }),
        "service-account",
      );
    });

    it("404s without publishing when the assignment is missing", async () => {
      mockPrisma.assignment.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.publishAssignment(404, { questions: [] } as any),
      ).rejects.toThrow(NotFoundException);
      expect(mockAssignmentService.publishAssignment).not.toHaveBeenCalled();
    });
  });

  describe("getAssignmentAnalytics", () => {
    const adminSession = {
      userId: "admin-1",
      role: UserRole.ADMIN,
    } as unknown as UserSession;

    // The assignment.findMany is called twice: once for the paged listing
    // (carries `take`) and once id-only for the filter-wide aggregate set.
    // Route each call to the right fixture by inspecting the args.
    const setAssignments = (
      pageRows: Array<{
        id: number;
        name: string;
        published: boolean;
        updatedAt: Date;
      }>,
      allMatchingIds: number[],
    ) => {
      mockPrisma.assignment.findMany.mockImplementation((args: any) =>
        args?.take === undefined
          ? Promise.resolve(allMatchingIds.map((id) => ({ id })))
          : Promise.resolve(pageRows),
      );
    };

    // Route assignmentAttempt.findMany: the aggregate path asks for distinct
    // (assignmentId, userId) pairs; the per-row path asks for distinct userId.
    const setAttemptFindMany = (
      pairRows: Array<{ assignmentId: number; userId: string }>,
      perRowUsers: Array<{ userId: string }> = [],
    ) => {
      mockPrisma.assignmentAttempt.findMany.mockImplementation((args: any) =>
        Array.isArray(args?.distinct) && args.distinct.includes("assignmentId")
          ? Promise.resolve(pairRows)
          : Promise.resolve(perRowUsers),
      );
    };

    const pageRow = (id: number, published = true) => ({
      id,
      name: `Assignment ${id}`,
      published,
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    it("orders the paged query by the requested sortBy/sortOrder", async () => {
      mockPrisma.assignment.count.mockResolvedValue(1);
      setAssignments([pageRow(1)], [1]);

      await service.getAssignmentAnalytics(
        adminSession,
        1,
        25,
        undefined,
        false,
        "name",
        "asc",
      );

      const pagedCall = mockPrisma.assignment.findMany.mock.calls.find(
        ([args]) => args?.take !== undefined,
      );
      expect(pagedCall?.[0].orderBy).toEqual({ name: "asc" });
    });

    it("defaults the order to updatedAt desc when no sort is given", async () => {
      mockPrisma.assignment.count.mockResolvedValue(1);
      setAssignments([pageRow(1)], [1]);

      await service.getAssignmentAnalytics(adminSession, 1, 25);

      const pagedCall = mockPrisma.assignment.findMany.mock.calls.find(
        ([args]) => args?.take !== undefined,
      );
      expect(pagedCall?.[0].orderBy).toEqual({ updatedAt: "desc" });
    });

    it("filters by published when the flag is provided", async () => {
      setAssignments([], []);

      await service.getAssignmentAnalytics(
        adminSession,
        1,
        25,
        undefined,
        false,
        undefined,
        undefined,
        true,
      );

      // The filtered-id scan (the source of the total) carries the filter.
      expect(mockPrisma.assignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ published: true }),
          select: { id: true },
        }),
      );
    });

    it("omits the published filter entirely when the flag is undefined", async () => {
      setAssignments([], []);

      await service.getAssignmentAnalytics(adminSession, 1, 25);

      const idScan = mockPrisma.assignment.findMany.mock.calls.find(
        ([args]: [{ take?: number }]) => args?.take === undefined,
      );
      expect(idScan?.[0].where).not.toHaveProperty("published");
    });

    it("reports pagination.total from the full filtered set, not the page size", async () => {
      setAssignments([pageRow(1), pageRow(2)], [1, 2, 3, 4, 5, 6, 7]);

      const result = await service.getAssignmentAnalytics(
        adminSession,
        1,
        25,
        undefined,
        false,
        undefined,
        undefined,
        true,
      );

      expect(result.pagination).toEqual({
        total: 7,
        page: 1,
        limit: 25,
        totalPages: 1,
      });
      // The filtered-id scan (the source of the total) carries the same filter.
      expect(mockPrisma.assignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ published: true }),
          select: { id: true },
        }),
      );
    });

    it("computes aggregates over the full filtered set, not just the page", async () => {
      mockPrisma.assignment.count.mockResolvedValue(50);
      setAssignments(
        [pageRow(1), pageRow(2)], // page shows 2 rows
        Array.from({ length: 50 }, (_, i) => i + 1), // 50 match the filter
      );
      setAttemptFindMany(
        Array.from({ length: 30 }, (_, i) => ({
          assignmentId: i,
          userId: `u${i}`,
        })),
      );
      mockPrisma.assignmentFeedback.aggregate.mockResolvedValue({
        _avg: { assignmentRating: 4.5 },
      });

      const result = await service.getAssignmentAnalytics(adminSession, 1, 25);

      expect(result.data).toHaveLength(2);
      expect(result.aggregates).toEqual({
        totalAssignments: 50, // from count, not page length
        totalCost: 0,
        totalLearnerAssignmentPairs: 30, // from the full distinct-pair set
        averageRating: 4.5,
      });
    });

    it("still returns populated aggregates when the requested page is empty", async () => {
      mockPrisma.assignment.count.mockResolvedValue(5);
      setAssignments([], [1, 2, 3, 4, 5]); // out-of-range page, but matches exist
      setAttemptFindMany([
        { assignmentId: 1, userId: "u1" },
        { assignmentId: 1, userId: "u2" },
      ]);
      mockPrisma.assignmentFeedback.aggregate.mockResolvedValue({
        _avg: { assignmentRating: 3 },
      });

      const result = await service.getAssignmentAnalytics(
        adminSession,
        999,
        25,
      );

      expect(result.data).toEqual([]);
      expect(result.pagination).toEqual({
        total: 5,
        page: 999,
        limit: 25,
        totalPages: 1,
      });
      expect(result.aggregates).toEqual({
        totalAssignments: 5,
        totalCost: 0,
        totalLearnerAssignmentPairs: 2,
        averageRating: 3,
      });
    });

    it("short-circuits to empty aggregates when nothing matches the filter", async () => {
      mockPrisma.assignment.count.mockResolvedValue(0);
      setAssignments([], []);

      const result = await service.getAssignmentAnalytics(
        adminSession,
        1,
        25,
        "no-such-assignment",
      );

      expect(result.data).toEqual([]);
      expect(result.aggregates).toEqual({
        totalAssignments: 0,
        totalCost: 0,
        totalLearnerAssignmentPairs: 0,
        averageRating: 0,
      });
      // The aggregate query work is skipped entirely for an empty match set.
      expect(mockPrisma.assignmentFeedback.aggregate).not.toHaveBeenCalled();
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
