/* eslint-disable @typescript-eslint/unbound-method */

import { Test, TestingModule } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { AttemptAccessCacheService } from "src/api/attempt/services/attempt-access-cache.service";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import { PrismaService } from "src/database/prisma.service";
import { JOB_NAMES, JOB_QUEUE_NAMES } from "src/job-queue/job-queue.constants";
import { JobQueueService } from "src/job-queue/job-queue.service";
import {
  createMockAssignmentRepository,
  createMockJobQueueService,
  createMockJobStatusService,
  createMockLlmFacadeService,
  createMockLogger,
  createMockPrismaService,
  createMockQuestionService,
  createMockTranslationService,
  createMockUpdateAssignmentQuestionsDto,
  createMockVersionManagementService,
} from "../__mocks__/ common-mocks";
import { AssignmentRepository } from "../../../repositories/assignment.repository";
import { AssignmentServiceV2 } from "../../../services/assignment.service";
import { JobStatusServiceV2 } from "../../../services/job-status.service";
import { QuestionService } from "../../../services/question.service";
import { TranslationService } from "../../../services/translation.service";
import { VersionManagementService } from "../../../services/version-management.service";

describe("AssignmentServiceV2 – publishAssignment dedup", () => {
  let service: AssignmentServiceV2;
  let assignmentRepository: ReturnType<typeof createMockAssignmentRepository>;
  let questionService: ReturnType<typeof createMockQuestionService>;
  let translationService: ReturnType<typeof createMockTranslationService>;
  let versionManagementService: ReturnType<
    typeof createMockVersionManagementService
  >;
  let jobStatusService: ReturnType<typeof createMockJobStatusService>;
  let jobQueueService: ReturnType<typeof createMockJobQueueService>;
  let prismaService: ReturnType<typeof createMockPrismaService>;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(async () => {
    assignmentRepository = createMockAssignmentRepository();
    questionService = createMockQuestionService();
    translationService = createMockTranslationService();
    versionManagementService = createMockVersionManagementService();
    jobStatusService = createMockJobStatusService();
    jobQueueService = createMockJobQueueService();
    prismaService = createMockPrismaService();
    const llmService = createMockLlmFacadeService();
    logger = createMockLogger();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssignmentServiceV2,
        { provide: AssignmentRepository, useValue: assignmentRepository },
        { provide: QuestionService, useValue: questionService },
        { provide: TranslationService, useValue: translationService },
        {
          provide: VersionManagementService,
          useValue: versionManagementService,
        },
        { provide: JobStatusServiceV2, useValue: jobStatusService },
        { provide: JobQueueService, useValue: jobQueueService },
        { provide: LlmFacadeService, useValue: llmService },
        { provide: PrismaService, useValue: prismaService },
        {
          provide: AttemptAccessCacheService,
          useValue: {
            invalidateForAssignment: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: WINSTON_MODULE_PROVIDER, useValue: { child: () => logger } },
      ],
    }).compile();

    service = module.get(AssignmentServiceV2);
  });

  afterEach(() => jest.clearAllMocks());

  it("returns existing job id when an active publish is already enqueued for the assignment", async () => {
    const dto = createMockUpdateAssignmentQuestionsDto();
    jobQueueService.findActiveJob.mockResolvedValueOnce({
      id: "publish:v2:42",
      state: "active",
    });

    const response = await service.publishAssignment(42, dto, "author-123");

    expect(jobQueueService.findActiveJob).toHaveBeenCalledWith(
      JOB_QUEUE_NAMES.ASSIGNMENT_V2,
      "publish:v2:42",
    );
    expect(jobStatusService.createPublishJob).not.toHaveBeenCalled();
    expect(jobQueueService.enqueue).not.toHaveBeenCalled();
    expect(response).toEqual({
      jobId: "publish:v2:42",
      message: "Publishing already in progress",
    });
  });

  it("proceeds normally when no active publish exists", async () => {
    const dto = createMockUpdateAssignmentQuestionsDto();
    jobQueueService.findActiveJob.mockResolvedValueOnce(null);

    await service.publishAssignment(42, dto, "author-123");

    expect(jobQueueService.findActiveJob).toHaveBeenCalledWith(
      JOB_QUEUE_NAMES.ASSIGNMENT_V2,
      "publish:v2:42",
    );
    expect(jobStatusService.createPublishJob).toHaveBeenCalledWith(
      42,
      "author-123",
      { reservedId: "publish:v2:42" },
    );
    expect(jobQueueService.enqueue).toHaveBeenCalledWith(
      JOB_QUEUE_NAMES.ASSIGNMENT_V2,
      JOB_NAMES.ASSIGNMENT_V2_PUBLISH,
      expect.objectContaining({ assignmentId: 42, userId: "author-123" }),
      expect.objectContaining({
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      }),
    );
  });

  it("proceeds normally when previous publish was completed (history kept by the queue)", async () => {
    // findActiveJob filters terminal states (completed/failed/unknown) to null,
    // so the service should treat it as no active job and enqueue afresh.
    const dto = createMockUpdateAssignmentQuestionsDto();
    jobQueueService.findActiveJob.mockResolvedValueOnce(null);

    await service.publishAssignment(42, dto, "author-123");

    expect(jobStatusService.createPublishJob).toHaveBeenCalledWith(
      42,
      "author-123",
      { reservedId: "publish:v2:42" },
    );
    expect(jobQueueService.enqueue).toHaveBeenCalledTimes(1);
  });
});
