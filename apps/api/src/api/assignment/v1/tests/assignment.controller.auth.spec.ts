/* eslint-disable @typescript-eslint/unbound-method */

import { NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { JobStatusServiceV1 } from "src/api/Job/job-status.service";
import { AssignmentAccessControlGuard } from "src/api/assignment/guards/assignment.access.control.guard";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import { PrismaService } from "src/database/prisma.service";

import { AssignmentControllerV1 } from "../controllers/assignment.controller";
import { AssignmentServiceV1 } from "../services/assignment.service";

describe("AssignmentControllerV1 — publish job status auth", () => {
  let controller: AssignmentControllerV1;
  let assignmentService: { getJobStatus: jest.Mock };
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
    id: "publish:v1:100",
    queueName: "mark.assignment.v1",
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
    groupId: string | undefined = "group-shared",
  ) => ({
    userSession: { userId, groupId },
  });

  beforeEach(async () => {
    assignmentService = {
      getJobStatus: jest.fn(),
    };

    prisma = {
      assignmentGroup: {
        findFirst: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AssignmentControllerV1],
      providers: [
        { provide: AssignmentServiceV1, useValue: assignmentService },
        { provide: LlmFacadeService, useValue: {} },
        {
          provide: JobStatusServiceV1,
          useValue: {
            getJobStatusStream: jest.fn().mockReturnValue({}),
          },
        },
        { provide: PrismaService, useValue: prisma },
        { provide: WINSTON_MODULE_PROVIDER, useValue: mockLogger },
      ],
    })
      .overrideGuard(AssignmentAccessControlGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AssignmentControllerV1);
  });

  describe("getJobStatus", () => {
    it("returns the job to its creator without consulting the assignment-group table", async () => {
      assignmentService.getJobStatus.mockResolvedValue(
        buildJob({ status: "Completed", result: [{ id: 1 }] }),
      );

      const result = await controller.getJobStatus(
        "publish:v1:100",
        buildSessionRequest("author-A@example.com") as never,
      );

      expect(result.status).toBe("Completed");
      expect(prisma.assignmentGroup.findFirst).not.toHaveBeenCalled();
    });

    it("returns the job to a co-author whose group is linked to the same assignment", async () => {
      assignmentService.getJobStatus.mockResolvedValue(buildJob());
      prisma.assignmentGroup.findFirst.mockResolvedValue({ assignmentId: 100 });

      const result = await controller.getJobStatus(
        "publish:v1:100",
        buildSessionRequest("author-B@example.com") as never,
      );

      expect(result.status).toBe("In Progress");
      expect(prisma.assignmentGroup.findFirst).toHaveBeenCalledWith({
        where: { assignmentId: 100, groupId: "group-shared" },
        select: { assignmentId: true },
      });
    });

    it("404s a non-author whose group has no link to the assignment", async () => {
      assignmentService.getJobStatus.mockResolvedValue(buildJob());
      prisma.assignmentGroup.findFirst.mockResolvedValue(null);

      await expect(
        controller.getJobStatus(
          "publish:v1:100",
          buildSessionRequest("stranger@example.com", "other-group") as never,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("404s when the caller's session has no groupId — must not let Prisma's undefined-drops-key behavior collapse the where clause", async () => {
      assignmentService.getJobStatus.mockResolvedValue(buildJob());

      const noGroupSession = {
        userSession: { userId: "ghost@example.com", groupId: undefined },
      };

      await expect(
        controller.getJobStatus("publish:v1:100", noGroupSession as never),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.assignmentGroup.findFirst).not.toHaveBeenCalled();
    });

    it("404s when the caller's session has empty-string groupId", async () => {
      assignmentService.getJobStatus.mockResolvedValue(buildJob());

      await expect(
        controller.getJobStatus(
          "publish:v1:100",
          buildSessionRequest("ghost@example.com", "") as never,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.assignmentGroup.findFirst).not.toHaveBeenCalled();
    });

    it("404s when the job is missing", async () => {
      assignmentService.getJobStatus.mockResolvedValue(null);

      await expect(
        controller.getJobStatus(
          "publish:v1:100",
          buildSessionRequest("author-A@example.com") as never,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("sendPublishJobStatus", () => {
    it("opens a stream for a co-author of the assignment", async () => {
      assignmentService.getJobStatus.mockResolvedValue(buildJob());
      prisma.assignmentGroup.findFirst.mockResolvedValue({ assignmentId: 100 });

      const stream = await controller.sendPublishJobStatus(
        "publish:v1:100",
        buildSessionRequest("author-B@example.com") as never,
      );

      expect(stream).toBeDefined();
    });

    it("404s a non-author trying to subscribe to the stream", async () => {
      assignmentService.getJobStatus.mockResolvedValue(buildJob());
      prisma.assignmentGroup.findFirst.mockResolvedValue(null);

      await expect(
        controller.sendPublishJobStatus(
          "publish:v1:100",
          buildSessionRequest("stranger@example.com", "other-group") as never,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
