/* eslint-disable @typescript-eslint/unbound-method */

import { NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { AdminService } from "src/api/admin/admin.service";
import { AssignmentAccessControlGuard } from "src/api/assignment/guards/assignment.access.control.guard";
import { AdminGuard } from "src/auth/guards/admin.guard";
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
  let prisma: { assignmentGroup: { findFirst: jest.Mock } };

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
        { provide: AdminService, useValue: {} },
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
});
