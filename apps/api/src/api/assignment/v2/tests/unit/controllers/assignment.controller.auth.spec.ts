/* eslint-disable @typescript-eslint/unbound-method */

import "reflect-metadata";
import { NotFoundException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { Test, TestingModule } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { AdminService } from "src/api/admin/admin.service";
import { AssignmentAccessControlGuard } from "src/api/assignment/guards/assignment.access.control.guard";
import { AdminGuard } from "src/auth/guards/admin.guard";
import { ROLES_KEY } from "src/auth/role/roles.global.guard";
import { PrismaService } from "src/database/prisma.service";
import { AssignmentControllerV2 } from "../../../controllers/assignment.controller";
import { AssignmentFileService } from "../../../services/assignment-file.service";
import { AssignmentServiceV2 } from "../../../services/assignment.service";
import { JobStatusServiceV2 } from "../../../services/job-status.service";
import { QuestionService } from "../../../services/question.service";
import { ReportService } from "../../../services/report.repository";

describe("AssignmentControllerV2 — publish job status auth", () => {
  let controller: AssignmentControllerV2;
  let jobStatusService: { getJobStatus: jest.Mock };
  let prisma: {
    assignmentGroup: { findFirst: jest.Mock };
    assignmentAuthor: { findFirst: jest.Mock };
  };
  let adminService: { getDetailedAssignmentInsights: jest.Mock };

  const mockLogger = {
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
  };

  const buildJob = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: "publish:v2:100",
    queueName: "assignment-v2",
    jobName: "publish",
    kind: "assignment-publish",
    userId: "author-A@example.com",
    assignmentId: 100,
    status: "In Progress",
    progress: "Translating questions",
    createdAt: "2026-05-08T12:00:00.000Z",
    updatedAt: "2026-05-08T12:00:05.000Z",
    ...overrides,
  });

  const buildSessionRequest = (
    userId: string,
    groupId = "group-shared",
    extra: Record<string, unknown> = {},
  ) => {
    const handlers: Record<string, () => void> = {};
    return {
      userSession: { userId, groupId },
      on: jest.fn((event: string, handler: () => void) => {
        handlers[event] = handler;
      }),
      ...extra,
    };
  };

  beforeEach(async () => {
    jobStatusService = {
      getJobStatus: jest.fn(),
    };

    prisma = {
      assignmentGroup: {
        findFirst: jest.fn(),
      },
      assignmentAuthor: {
        findFirst: jest.fn(),
      },
    };

    adminService = {
      getDetailedAssignmentInsights: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AssignmentControllerV2],
      providers: [
        { provide: AssignmentServiceV2, useValue: {} },
        { provide: AssignmentFileService, useValue: {} },
        { provide: QuestionService, useValue: {} },
        { provide: ReportService, useValue: {} },
        {
          provide: JobStatusServiceV2,
          useValue: {
            ...jobStatusService,
            getPublishJobStatusStream: jest.fn().mockReturnValue({}),
            cleanupJobStream: jest.fn(),
          },
        },
        { provide: AdminService, useValue: adminService },
        { provide: PrismaService, useValue: prisma },
        { provide: WINSTON_MODULE_PROVIDER, useValue: mockLogger },
      ],
    })
      .overrideGuard(AssignmentAccessControlGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AssignmentControllerV2);
  });

  describe("getJobStatus", () => {
    it("returns the job to its creator without consulting the assignment-group table", async () => {
      jobStatusService.getJobStatus.mockResolvedValue(
        buildJob({ status: "Completed", result: [{ id: 1 }] }),
      );

      const result = await controller.getJobStatus(
        "publish:v2:100",
        buildSessionRequest("author-A@example.com") as never,
      );

      expect(result.status).toBe("Completed");
      expect(prisma.assignmentGroup.findFirst).not.toHaveBeenCalled();
    });

    it("returns the job to a co-author whose group is linked to the same assignment", async () => {
      jobStatusService.getJobStatus.mockResolvedValue(buildJob());
      prisma.assignmentGroup.findFirst.mockResolvedValue({ assignmentId: 100 });

      const result = await controller.getJobStatus(
        "publish:v2:100",
        buildSessionRequest("author-B@example.com") as never,
      );

      expect(result.status).toBe("In Progress");
      expect(prisma.assignmentGroup.findFirst).toHaveBeenCalledWith({
        where: { assignmentId: 100, groupId: "group-shared" },
        select: { assignmentId: true },
      });
    });

    it("404s a non-author whose group has no link to the assignment", async () => {
      jobStatusService.getJobStatus.mockResolvedValue(buildJob());
      prisma.assignmentGroup.findFirst.mockResolvedValue(null);

      await expect(
        controller.getJobStatus(
          "publish:v2:100",
          buildSessionRequest("stranger@example.com", "other-group") as never,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("404s when the job has no assignmentId and the caller is not the creator", async () => {
      jobStatusService.getJobStatus.mockResolvedValue(
        buildJob({ assignmentId: undefined }),
      );

      await expect(
        controller.getJobStatus(
          "publish:v2:100",
          buildSessionRequest("author-B@example.com") as never,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.assignmentGroup.findFirst).not.toHaveBeenCalled();
    });

    it("404s when the job is missing", async () => {
      jobStatusService.getJobStatus.mockResolvedValue(null);

      await expect(
        controller.getJobStatus(
          "publish:v2:100",
          buildSessionRequest("author-A@example.com") as never,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("404s when the caller's session has no groupId — must not let Prisma's undefined-drops-key behavior collapse the where clause", async () => {
      jobStatusService.getJobStatus.mockResolvedValue(buildJob());

      const noGroupSession = {
        userSession: { userId: "ghost@example.com", groupId: undefined },
        on: jest.fn(),
      };

      await expect(
        controller.getJobStatus("publish:v2:100", noGroupSession as never),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.assignmentGroup.findFirst).not.toHaveBeenCalled();
    });

    it("404s when the caller's session has empty-string groupId", async () => {
      jobStatusService.getJobStatus.mockResolvedValue(buildJob());

      await expect(
        controller.getJobStatus(
          "publish:v2:100",
          buildSessionRequest("ghost@example.com", "") as never,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.assignmentGroup.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("sendPublishJobStatus", () => {
    it("opens a stream for a co-author of the assignment", async () => {
      jobStatusService.getJobStatus.mockResolvedValue(buildJob());
      prisma.assignmentGroup.findFirst.mockResolvedValue({ assignmentId: 100 });

      const stream = await controller.sendPublishJobStatus(
        "publish:v2:100",
        buildSessionRequest("author-B@example.com") as never,
      );

      expect(stream).toBeDefined();
    });

    it("404s a non-author trying to subscribe to the stream", async () => {
      jobStatusService.getJobStatus.mockResolvedValue(buildJob());
      prisma.assignmentGroup.findFirst.mockResolvedValue(null);

      await expect(
        controller.sendPublishJobStatus(
          "publish:v2:100",
          buildSessionRequest("stranger@example.com", "other-group") as never,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("getAuthorAssignmentInsights", () => {
    it("404s when the caller is not an author of the assignment", async () => {
      prisma.assignmentAuthor.findFirst.mockResolvedValue(null);

      await expect(
        controller.getAuthorAssignmentInsights(
          100,
          buildSessionRequest("stranger@example.com") as never,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      // Must refuse before touching the (cache-backed) insights service.
      expect(adminService.getDetailedAssignmentInsights).not.toHaveBeenCalled();
    });

    it("returns ownership-scoped insights with admin-only and internal data stripped", async () => {
      prisma.assignmentAuthor.findFirst.mockResolvedValue({
        assignmentId: 100,
        userId: "author-A@example.com",
      });
      // Full admin payload — including the fields an author must never see.
      adminService.getDetailedAssignmentInsights.mockResolvedValue({
        assignment: { id: 100, name: "A" },
        questions: [{ id: 1 }],
        attempts: [{ id: 2, userId: "learner@example.com" }],
        feedback: [{ id: 3, userId: "learner@example.com" }],
        analytics: {
          totalCost: 12.34,
          costBreakdown: { grading: 1, questionGeneration: 2 },
          uniqueLearners: 5,
          totalAttempts: 9,
          completedAttempts: 4,
          averageGrade: 80,
          averageRating: 4.5,
          performanceInsights: ["insight"],
        },
        reports: [{ id: 7, description: "admin-only" }],
        aiUsage: [{ usageType: "ASSIGNMENT_GRADING", totalCost: 3.21 }],
        costCalculationDetails: { totalCost: 12.34, breakdown: [] },
        authorActivity: {
          totalAuthors: 2,
          authors: [{ userId: "co-author@example.com", totalAssignments: 42 }],
          activityInsights: ["busy"],
        },
      });

      const result = await controller.getAuthorAssignmentInsights(
        100,
        buildSessionRequest("author-A@example.com") as never,
      );

      // Kept: the author's own assignment, learner-scoped data, reports cleared.
      expect(result.assignment).toEqual({ id: 100, name: "A" });
      expect(result.questions).toEqual([{ id: 1 }]);
      expect(result.attempts).toEqual([
        { id: 2, userId: "learner@example.com" },
      ]);
      expect(result.feedback).toEqual([
        { id: 3, userId: "learner@example.com" },
      ]);
      expect(result.reports).toEqual([]);

      // Kept: non-cost analytics only.
      expect(result.analytics).toEqual({
        uniqueLearners: 5,
        totalAttempts: 9,
        completedAttempts: 4,
        averageGrade: 80,
        averageRating: 4.5,
        performanceInsights: ["insight"],
      });

      // Stripped: cross-author activity, internal model/pricing, AI spend.
      expect(result).not.toHaveProperty("authorActivity");
      expect(result).not.toHaveProperty("costCalculationDetails");
      expect(result).not.toHaveProperty("aiUsage");
      const analytics = result.analytics as Record<string, unknown>;
      expect(analytics).not.toHaveProperty("totalCost");
      expect(analytics).not.toHaveProperty("costBreakdown");

      // The full serialized response must not carry the other author's email or
      // any internal cost figure.
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain("co-author@example.com");
      expect(serialized).not.toContain("12.34");
      expect(serialized).not.toContain("3.21");

      expect(adminService.getDetailedAssignmentInsights).toHaveBeenCalledWith(
        { userId: "author-A@example.com", groupId: "group-shared" },
        100,
      );
    });
  });

  describe("getAssignmentAnalytics gating (admin-only)", () => {
    // The admin analytics route must be gated solely by AdminGuard, which
    // hard-rejects any non-admin session. It must NOT carry @Roles metadata:
    // RolesGlobalGuard is a no-op without it, AdminGuard stays the only gate,
    // and a stray @Roles(AUTHOR, ...) would only be misleading scaffolding.
    const handler = AssignmentControllerV2.prototype.getAssignmentAnalytics;

    it("is protected by AdminGuard", () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, handler) ?? [];
      expect(guards).toContain(AdminGuard);
    });

    it("carries no @Roles metadata so AdminGuard is the sole gate", () => {
      const roles = Reflect.getMetadata(ROLES_KEY, handler);
      expect(roles).toBeUndefined();
    });
  });
});
