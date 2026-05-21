import { Injectable } from "@nestjs/common";
import { JOB_NAMES, JOB_QUEUE_NAMES } from "src/job-queue/job-queue.constants";
import { JobStateService } from "src/job-queue/job-state.service";
import { JobStateRecord } from "src/job-queue/job-state.types";

@Injectable()
export class JobStatusServiceV1 {
  constructor(private readonly jobStateService: JobStateService) {}

  async createJob(
    assignmentId: number,
    userId: string,
  ): Promise<JobStateRecord> {
    return this.jobStateService.createJob({
      queueName: JOB_QUEUE_NAMES.ASSIGNMENT_V1,
      jobName: JOB_NAMES.ASSIGNMENT_V1_GENERATE_QUESTIONS,
      kind: "assignment-question-generation",
      assignmentId,
      userId,
      status: "Pending",
      progress: "Job created",
    });
  }

  getJobStatusStream(jobId: string) {
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
    progress: string,
    status = "In Progress",
    result?: unknown,
    percentage?: number,
  ): Promise<void> {
    await this.jobStateService.updateJobStatus(jobId, {
      status,
      progress,
      percentage,
      result,
    });
  }
}
