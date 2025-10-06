/* eslint-disable unicorn/no-null */
import { Injectable, Logger } from "@nestjs/common";
import { Job } from "@prisma/client";
import {
  catchError,
  concatWith,
  defer,
  finalize,
  from,
  interval,
  map,
  Observable,
  of,
  Subject,
  switchMap,
  takeWhile,
} from "rxjs";
import { PrismaService } from "src/database/prisma.service";

interface JobStatus {
  status: string;
  progress: string;
  percentage?: number;
  result?: any;
}

@Injectable()
export class JobStatusServiceV2 {
  private readonly logger = new Logger(JobStatusServiceV2.name);
  private jobStatusStreams = new Map<number, Subject<MessageEvent>>();

  constructor(private readonly prisma: PrismaService) {}

  async createJob(assignmentId: number, userId: string): Promise<Job> {
    return this.prisma.job.create({
      data: {
        assignmentId,
        userId,
        status: "Pending",
        progress: "Job created",
      },
    });
  }

  async createPublishJob(assignmentId: number, userId: string): Promise<Job> {
    return this.prisma.publishJob.create({
      data: {
        assignmentId,
        userId,
        status: "In Progress",
        progress: "Initializing assignment publishing...",
      },
    });
  }
  getPublishJobStatusStream(jobId: number): Observable<MessageEvent> {
    if (!this.jobStatusStreams.has(jobId)) {
      this.jobStatusStreams.set(jobId, new Subject<MessageEvent>());
    }

    const statusSubject = this.jobStatusStreams.get(jobId);
    if (!statusSubject) {
      throw new Error(`Job status stream for jobId ${jobId} not found.`);
    }

    return of(null).pipe(
      map(() => {
        return {
          type: "update",
          data: { message: "Connecting to job status stream..." },
        } as MessageEvent;
      }),

      concatWith(
        defer(() => from(this.getInitialJobStatus(jobId))),
        interval(1000).pipe(
          switchMap(() => from(this.pollJobStatus(jobId))),
          takeWhile((event) => {
            const status = (event as { data?: { status?: string } })?.data
              ?.status;
            return status !== "Completed" && status !== "Failed";
          }, true),
        ),
        statusSubject.asObservable(),
      ),
      finalize(() => {
        this.logger.log(`Stream closed for job ${jobId}`);
        void this.cleanupJobStream(jobId);
      }),
      catchError((error: Error) => {
        this.logger.error(
          `Stream error for job ${jobId}: ${error.message}`,
          error.stack,
        );
        return of({
          type: "error",
          data: {
            error: error.message,
            done: true,
          },
        } as MessageEvent);
      }),
    );
  }

  private async getInitialJobStatus(jobId: number): Promise<MessageEvent> {
    try {
      const job = await this.prisma.publishJob.findUnique({
        where: { id: jobId },
      });

      if (!job) {
        throw new Error(`Publish job with ID ${jobId} not found.`);
      }

      return {
        type: "update",
        data: {
          timestamp: new Date().toISOString(),
          status: job.status,
          progress: job.progress,
          percentage: job.percentage || 0,
          result: job.result ? JSON.stringify(job.result) : undefined,
          done: job.status === "Completed" || job.status === "Failed",
        },
      } as unknown as MessageEvent;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error getting initial job status: ${errorMessage}`);
      throw error;
    }
  }

  private async pollJobStatus(jobId: number): Promise<MessageEvent | null> {
    try {
      const job = await this.prisma.publishJob.findUnique({
        where: { id: jobId },
      });

      if (!job) {
        return null;
      }

      let messageType = "update";
      if (job.status === "Completed") {
        messageType = "finalize";
      } else if (job.status === "Failed") {
        messageType = "error";
      }

      return {
        type: messageType,
        data: {
          timestamp: new Date().toISOString(),
          status: job.status,
          progress: job.progress,
          percentage: job.percentage || 0,
          result: job.result,
          done: job.status === "Completed" || job.status === "Failed",
        },
      } as unknown as MessageEvent;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error polling job status: ${errorMessage}`);
      return null;
    }
  }

  async getJobStatus(jobId: number): Promise<Job | null> {
    return this.prisma.job.findUnique({
      where: { id: jobId },
    });
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async cleanupJobStream(jobId: number): Promise<void> {
    const subject = this.jobStatusStreams.get(jobId);
    if (subject) {
      subject.complete();
      this.jobStatusStreams.delete(jobId);
    }
  }
  async updateJobStatus(
    jobId: number,
    statusUpdate: JobStatus,
    isPublishJob = true,
  ): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      this.logger.log(
        `[${timestamp}] Updating job #${jobId} status: ${statusUpdate.status} - ${statusUpdate.progress} (${statusUpdate.percentage}%)`,
      );

      const sanitizedProgress = statusUpdate.progress
        ? statusUpdate.progress.slice(0, 255)
        : "Status update";

      const validPercentage =
        statusUpdate.percentage === undefined
          ? undefined
          : Math.max(0, Math.min(100, statusUpdate.percentage));

      const maxRetries = 3;
      let attempt = 0;
      let success = false;

      while (attempt < maxRetries && !success) {
        try {
          await (isPublishJob
            ? this.prisma.publishJob.update({
                where: { id: jobId },
                data: {
                  status: statusUpdate.status,
                  progress: sanitizedProgress,
                  percentage: validPercentage,
                  result: statusUpdate.result
                    ? JSON.stringify(statusUpdate.result)
                    : undefined,
                  updatedAt: new Date(),
                },
              })
            : this.prisma.job.update({
                where: { id: jobId },
                data: {
                  status: statusUpdate.status,
                  progress: sanitizedProgress,
                  result: statusUpdate.result
                    ? JSON.stringify(statusUpdate.result)
                    : undefined,
                  updatedAt: new Date(),
                },
              }));
          success = true;
        } catch (error: unknown) {
          attempt++;
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          if (attempt >= maxRetries) {
            this.logger.error(
              `Failed to update job #${jobId} status after ${maxRetries} attempts: ${errorMessage}`,
            );
          } else {
            this.logger.warn(
              `Failed to update job #${jobId} status (attempt ${attempt}/${maxRetries}): ${errorMessage}`,
            );

            await new Promise((resolve) =>
              setTimeout(resolve, 100 * Math.pow(2, attempt)),
            );
          }
        }
      }

      this.emitJobStatusUpdate(jobId, {
        ...statusUpdate,
        progress: sanitizedProgress,
        percentage: validPercentage,
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error in updateJobStatus for job #${jobId}: ${errorMessage}`,
      );

      const errorStatus: JobStatus = {
        status: "In Progress",
        progress: `Update error: ${errorMessage.slice(0, 100)}... (continuing)`,
        percentage: statusUpdate.percentage,
      };

      this.emitJobStatusUpdate(jobId, errorStatus);
    }
  }

  /**
   * Emit job status update with improved error handling and more detailed events
   *
   * @param jobId - The job ID
   * @param statusUpdate - Job status update details
   */
  private emitJobStatusUpdate(jobId: number, statusUpdate: JobStatus): void {
    try {
      const subject = this.jobStatusStreams.get(jobId);
      if (subject) {
        let messageType = "update";
        if (statusUpdate.status === "Completed") {
          messageType = "finalize";
        } else if (statusUpdate.status === "Failed") {
          messageType = "error";
        }

        const eventData = {
          timestamp: new Date().toISOString(),
          status: statusUpdate.status,
          progress: statusUpdate.progress,
          percentage: statusUpdate.percentage,
          result:
            statusUpdate.result === undefined
              ? undefined
              : JSON.stringify(statusUpdate.result),
          done:
            statusUpdate.status === "Completed" ||
            statusUpdate.status === "Failed",
        };

        subject.next({
          type: messageType,
          data: eventData,
        } as unknown as MessageEvent);

        if (
          statusUpdate.status === "Completed" ||
          statusUpdate.status === "Failed"
        ) {
          subject.next({
            type: "summary",
            data: {
              message: `Job ${statusUpdate.status.toLowerCase()}`,
              finalStatus: statusUpdate.status,
              duration: "Job duration information would be calculated here",
            },
          } as unknown as MessageEvent);

          subject.next({
            type: "close",
            data: { message: "Stream completed" },
          } as unknown as MessageEvent);

          setTimeout(() => {
            void this.cleanupJobStream(jobId);
          }, 1000);
        }
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error emitting status update for job #${jobId}: ${errorMessage}`,
      );
    }
  }
}
