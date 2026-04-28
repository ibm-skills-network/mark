import { Injectable } from "@nestjs/common";
import { JOB_NAMES, JOB_QUEUE_NAMES } from "src/job-queue/job-queue.constants";
import { JobStateService } from "src/job-queue/job-state.service";
import {
  CreateJobStateOptions,
  JobStateRecord,
  JobStatusUpdate,
} from "src/job-queue/job-state.types";

@Injectable()
export class JobStatusServiceV2 {
  constructor(private readonly jobStateService: JobStateService) {}

  async createTrackedJob(
    options: CreateJobStateOptions,
  ): Promise<JobStateRecord> {
    return this.jobStateService.createJob(options);
  }

  async createJob(
    assignmentId: number,
    userId: string,
  ): Promise<JobStateRecord> {
    return this.createTrackedJob({
      queueName: JOB_QUEUE_NAMES.ASSIGNMENT_V2,
      jobName: JOB_NAMES.ASSIGNMENT_V2_GENERATE_QUESTIONS,
      kind: "assignment-question-generation",
      assignmentId,
      userId,
      status: "Pending",
      progress: "Job created",
    });
  }

  async createPublishJob(
    assignmentId: number,
    userId: string,
    overrides: Partial<CreateJobStateOptions> = {},
  ): Promise<JobStateRecord> {
    return this.createTrackedJob({
      queueName: JOB_QUEUE_NAMES.ASSIGNMENT_V2,
      jobName: JOB_NAMES.ASSIGNMENT_V2_PUBLISH,
      kind: "assignment-publish",
      assignmentId,
      userId,
      status: "In Progress",
      progress: "Initializing assignment publishing...",
      ...overrides,
    });
  }

  getPublishJobStatusStream(jobId: string) {
    return this.jobStateService.getJobStatusStream(jobId);
  }

  async getJobStatus(jobId: string): Promise<JobStateRecord | null> {
    return this.jobStateService.getJob(jobId);
  }

  async cleanupJobStream(jobId: string): Promise<void> {
    await this.jobStateService.cleanupJobStream(jobId);
  }

  async updateJobStatus(
    jobId: string,
    statusUpdate: JobStatusUpdate,
    _isPublishJob = true,
  ): Promise<void> {
    void _isPublishJob;
    await this.jobStateService.updateJobStatus(jobId, statusUpdate);
  }
}
