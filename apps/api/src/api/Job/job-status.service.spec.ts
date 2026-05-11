import { Test, TestingModule } from "@nestjs/testing";
import { JOB_NAMES, JOB_QUEUE_NAMES } from "src/job-queue/job-queue.constants";
import { JobStateService } from "src/job-queue/job-state.service";
import { JobStatusServiceV1 } from "./job-status.service";

describe("JobStatusServiceV1", () => {
  let service: JobStatusServiceV1;
  let jobStateService: {
    createJob: jest.Mock;
    getJobStatusStream: jest.Mock;
    getJob: jest.Mock;
    cleanupJobStream: jest.Mock;
    updateJobStatus: jest.Mock;
  };

  beforeEach(async () => {
    jobStateService = {
      createJob: jest.fn().mockResolvedValue({ id: "job-v1" }),
      getJobStatusStream: jest.fn().mockReturnValue("stream"),
      getJob: jest.fn().mockResolvedValue({ id: "job-v1" }),
      cleanupJobStream: jest.fn().mockResolvedValue(undefined),
      updateJobStatus: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobStatusServiceV1,
        {
          provide: JobStateService,
          useValue: jobStateService,
        },
      ],
    }).compile();

    service = module.get<JobStatusServiceV1>(JobStatusServiceV1);
  });

  it("creates tracked v1 generation jobs", async () => {
    await service.createJob(11, "author-1");

    expect(jobStateService.createJob).toHaveBeenCalledWith({
      queueName: JOB_QUEUE_NAMES.ASSIGNMENT_V1,
      jobName: JOB_NAMES.ASSIGNMENT_V1_GENERATE_QUESTIONS,
      kind: "assignment-question-generation",
      assignmentId: 11,
      userId: "author-1",
      status: "Pending",
      progress: "Job created",
    });
  });

  it("delegates reads, cleanup, streams, and updates", async () => {
    await service.getJobStatus("job-v1");
    expect(service.getJobStatusStream("job-v1")).toBe("stream");
    await service.cleanupJobStream("job-v1");
    await service.updateJobStatus(
      "job-v1",
      "Processing assignment",
      "Processing",
      { score: 99 },
      67,
    );

    expect(jobStateService.getJob).toHaveBeenCalledWith("job-v1");
    expect(jobStateService.getJobStatusStream).toHaveBeenCalledWith("job-v1");
    expect(jobStateService.cleanupJobStream).toHaveBeenCalledWith("job-v1");
    expect(jobStateService.updateJobStatus).toHaveBeenCalledWith("job-v1", {
      status: "Processing",
      progress: "Processing assignment",
      percentage: 67,
      result: { score: 99 },
    });
  });
});
