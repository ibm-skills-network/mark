import { Test, TestingModule } from "@nestjs/testing";
import { JOB_NAMES, JOB_QUEUE_NAMES } from "src/job-queue/job-queue.constants";
import { JobStateService } from "src/job-queue/job-state.service";
import { JobStateRecord } from "src/job-queue/job-state.types";
import { JobStatusServiceV2 } from "../../../services/job-status.service";

describe("JobStatusServiceV2", () => {
  let service: JobStatusServiceV2;
  let jobStateService: {
    createJob: jest.Mock;
    getJobStatusStream: jest.Mock;
    getJob: jest.Mock;
    cleanupJobStream: jest.Mock;
    updateJobStatus: jest.Mock;
  };

  const mockJob: JobStateRecord = {
    id: "job-123",
    queueName: JOB_QUEUE_NAMES.ASSIGNMENT_V2,
    jobName: JOB_NAMES.ASSIGNMENT_V2_GENERATE_QUESTIONS,
    kind: "assignment-question-generation",
    assignmentId: 42,
    attemptId: undefined,
    userId: "author-1",
    status: "Pending",
    progress: "Job created",
    percentage: 0,
    createdAt: "2026-03-04T00:00:00.000Z",
    updatedAt: "2026-03-04T00:00:00.000Z",
  };

  beforeEach(async () => {
    jobStateService = {
      createJob: jest.fn().mockResolvedValue(mockJob),
      getJobStatusStream: jest.fn().mockReturnValue("stream"),
      getJob: jest.fn().mockResolvedValue(mockJob),
      cleanupJobStream: jest.fn().mockResolvedValue(undefined),
      updateJobStatus: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobStatusServiceV2,
        {
          provide: JobStateService,
          useValue: jobStateService,
        },
      ],
    }).compile();

    service = module.get<JobStatusServiceV2>(JobStatusServiceV2);
  });

  it("creates assignment question-generation jobs with the expected queue metadata", async () => {
    await expect(service.createJob(42, "author-1")).resolves.toEqual(mockJob);

    expect(jobStateService.createJob).toHaveBeenCalledWith({
      queueName: JOB_QUEUE_NAMES.ASSIGNMENT_V2,
      jobName: JOB_NAMES.ASSIGNMENT_V2_GENERATE_QUESTIONS,
      kind: "assignment-question-generation",
      assignmentId: 42,
      userId: "author-1",
      status: "Pending",
      progress: "Job created",
    });
  });

  it("creates publish jobs and merges explicit overrides", async () => {
    await service.createPublishJob(42, "author-1", {
      status: "Pending",
      activeKey: "assignment:42:user:author-1",
    });

    expect(jobStateService.createJob).toHaveBeenCalledWith({
      queueName: JOB_QUEUE_NAMES.ASSIGNMENT_V2,
      jobName: JOB_NAMES.ASSIGNMENT_V2_PUBLISH,
      kind: "assignment-publish",
      assignmentId: 42,
      userId: "author-1",
      status: "Pending",
      progress: "Initializing assignment publishing...",
      activeKey: "assignment:42:user:author-1",
    });
  });

  it("delegates reads, streaming, cleanup, and updates to the Redis-backed state service", async () => {
    await expect(service.getJobStatus("job-123")).resolves.toEqual(mockJob);
    expect(service.getPublishJobStatusStream("job-123")).toBe("stream");

    await service.cleanupJobStream("job-123");
    await service.updateJobStatus("job-123", {
      status: "Completed",
      progress: "Done",
      percentage: 100,
    });

    expect(jobStateService.getJob).toHaveBeenCalledWith("job-123");
    expect(jobStateService.getJobStatusStream).toHaveBeenCalledWith("job-123");
    expect(jobStateService.cleanupJobStream).toHaveBeenCalledWith("job-123");
    expect(jobStateService.updateJobStatus).toHaveBeenCalledWith("job-123", {
      status: "Completed",
      progress: "Done",
      percentage: 100,
    });
  });
});
