/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable unicorn/no-null */
/* eslint-disable @typescript-eslint/require-await */
import { Injectable } from "@nestjs/common";
import { GradingJob, ReportType } from "@prisma/client";
import { Response as ExpressResponse } from "express";
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
import { BaseAssignmentAttemptResponseDto } from "src/api/assignment/attempt/dto/assignment-attempt/base.assignment.attempt.response.dto";
import { LearnerUpdateAssignmentAttemptRequestDto } from "src/api/assignment/attempt/dto/assignment-attempt/create.update.assignment.attempt.request.dto";
import {
  AssignmentFeedbackDto,
  AssignmentFeedbackResponseDto,
  RegradingRequestDto,
  RegradingStatusResponseDto,
  RequestRegradingResponseDto,
} from "src/api/assignment/attempt/dto/assignment-attempt/feedback.request.dto";
import {
  AssignmentAttemptResponseDto,
  GetAssignmentAttemptResponseDto,
} from "src/api/assignment/attempt/dto/assignment-attempt/get.assignment.attempt.response.dto";
import { UpdateAssignmentAttemptResponseDto } from "src/api/assignment/attempt/dto/assignment-attempt/update.assignment.attempt.response.dto";
import { JobStatusServiceV2 } from "src/api/assignment/v2/services/job-status.service";
import {
  UserRole,
  UserSession,
  UserSessionRequest,
} from "../../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../../prisma.service";
import { AttemptFeedbackService } from "./attempt-feedback.service";
import { AttemptRegradingService } from "./attempt-regrading.service";
import { AttemptReportingService } from "./attempt-reporting.service";
import { AttemptSubmissionService } from "./attempt-submission.service";

@Injectable()
export class AttemptServiceV2 {
  private gradingJobStreams = new Map<number, Subject<MessageEvent>>();
  constructor(
    private readonly prisma: PrismaService,
    private readonly submissionService: AttemptSubmissionService,
    private readonly feedbackService: AttemptFeedbackService,
    private readonly regradingService: AttemptRegradingService,
    private readonly reportingService: AttemptReportingService,
    private readonly jobStatusService: JobStatusServiceV2,
  ) {}

  /**
   * Create a grading job for author preview (no attemptId)
   */
  async createAuthorGradingJob(
    assignmentId: number,
    updateDto: LearnerUpdateAssignmentAttemptRequestDto,
    authCookie: string,
    request: UserSessionRequest,
  ): Promise<{ gradingJobId: number; message: string }> {
    // Create a grading job without attemptId for author preview
    const gradingJob = await this.prisma.gradingJob.create({
      data: {
        attemptId: null, // No attempt for author mode
        assignmentId,
        userId: request.userSession.userId,
        status: "Pending",
        progress: "Author preview job created",
      },
    });

    return {
      gradingJobId: gradingJob.id,
      message:
        "Author preview job created. Use the SSE endpoint to track progress.",
    };
  }
  /**
   * Create a grading job for long-running grading operations
   */
  async createGradingJob(
    attemptId: number,
    assignmentId: number,
    updateDto: LearnerUpdateAssignmentAttemptRequestDto,
    authCookie: string,
    request: UserSessionRequest,
  ): Promise<{ gradingJobId: number; message: string }> {
    // Create a grading job in the database
    const gradingJob = await this.prisma.gradingJob.create({
      data: {
        attemptId,
        assignmentId,
        userId: request.userSession.userId,
        status: "Pending",
        progress: "Grading job created",
      },
    });

    return {
      gradingJobId: gradingJob.id,
      message: "Grading job created. Use the SSE endpoint to track progress.",
    };
  }

  /**
   * Process author preview job asynchronously
   */
  async processAuthorPreviewJob(
    gradingJobId: number,
    assignmentId: number,
    updateDto: LearnerUpdateAssignmentAttemptRequestDto,
    authCookie: string,
    request: UserSessionRequest,
  ): Promise<void> {
    try {
      // Update job status to processing
      await this.updateGradingJobStatus(gradingJobId, {
        status: "Processing",
        progress: "Starting author preview grading...",
        percentage: 0,
      });

      // Call the submission service for author preview
      const result = await this.submissionService.updateAssignmentAttempt(
        -1, // Fake attempt ID for author mode
        assignmentId,
        updateDto,
        authCookie,
        false,
        request,
        async (progress: string, percentage?: number) => {
          await this.updateGradingJobStatus(gradingJobId, {
            status: "Processing",
            progress,
            percentage: percentage || 0,
          });
        },
      );

      // Update job status to completed
      await this.updateGradingJobStatus(gradingJobId, {
        status: "Completed",
        progress: "Author preview completed successfully",
        percentage: 100,
        result,
      });
    } catch (error) {
      // Update job status to failed
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      await this.updateGradingJobStatus(gradingJobId, {
        status: "Failed",
        progress: `Author preview failed: ${errorMessage}`,
        percentage: 0,
      });
      throw error;
    }
  }

  /**
   * Process the grading job asynchronously
   */
  async processGradingJob(
    gradingJobId: number,
    attemptId: number,
    assignmentId: number,
    updateDto: LearnerUpdateAssignmentAttemptRequestDto,
    authCookie: string,
    request: UserSessionRequest,
  ): Promise<void> {
    try {
      await this.updateGradingJobStatus(gradingJobId, {
        status: "Processing",
        progress: "Starting grading process...",
        percentage: 0,
      });

      const result = await this.submissionService.updateAssignmentAttempt(
        attemptId,
        assignmentId,
        updateDto,
        authCookie,
        request.userSession.gradingCallbackRequired,
        request,
        async (progress: string, percentage?: number) => {
          await this.updateGradingJobStatus(gradingJobId, {
            status: "Processing",
            progress,
            percentage,
          });
        },
      );

      // Update job status to completed
      await this.updateGradingJobStatus(gradingJobId, {
        status: "Completed",
        progress: "Grading completed successfully",
        percentage: 100,
        result,
      });
    } catch (error) {
      // Update job status to failed
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      await this.updateGradingJobStatus(gradingJobId, {
        status: "Failed",
        progress: `Grading failed: ${errorMessage}`,
        percentage: 0,
      });
      throw error;
    }
  }

  /**
   * Get grading job by ID
   */
  async getGradingJob(gradingJobId: number): Promise<GradingJob | null> {
    return this.prisma.gradingJob.findUnique({
      where: { id: gradingJobId },
    });
  }

  /**
   * Update grading job status
   */
  async updateGradingJobStatus(
    gradingJobId: number,
    statusUpdate: {
      status: string;
      progress: string;
      percentage?: number;
      result?: any;
    },
  ): Promise<void> {
    await this.prisma.gradingJob.update({
      where: { id: gradingJobId },
      data: {
        status: statusUpdate.status,
        progress: statusUpdate.progress,
        percentage: statusUpdate.percentage,
        result: statusUpdate.result
          ? JSON.stringify(statusUpdate.result)
          : undefined,
        updatedAt: new Date(),
      },
    });

    // Emit status update to SSE stream
    this.emitGradingJobStatusUpdate(gradingJobId, statusUpdate);
  }

  /**
   * Get grading job status stream
   */
  getGradingJobStatusStream(gradingJobId: number): Observable<MessageEvent> {
    if (!this.gradingJobStreams.has(gradingJobId)) {
      this.gradingJobStreams.set(gradingJobId, new Subject<MessageEvent>());
    }

    const statusSubject = this.gradingJobStreams.get(gradingJobId);
    if (!statusSubject) {
      throw new Error(
        `Grading job status stream for jobId ${gradingJobId} not found.`,
      );
    }

    return of(null).pipe(
      map(() => {
        return {
          type: "update",
          data: { message: "Connecting to grading job status stream..." },
        } as MessageEvent;
      }),
      concatWith(
        defer(() => from(this.getInitialGradingJobStatus(gradingJobId))),
        interval(1000).pipe(
          switchMap(() => from(this.pollGradingJobStatus(gradingJobId))),
          takeWhile((event) => {
            const status = (event as { data?: { status?: string } })?.data
              ?.status;
            return status !== "Completed" && status !== "Failed";
          }, true),
        ),
        statusSubject.asObservable(),
      ),
      finalize(() => {
        console.log(`Stream closed for grading job ${gradingJobId}`);
        void this.cleanupGradingJobStream(gradingJobId);
      }),
      catchError((error: Error) => {
        console.error(`Stream error for grading job ${gradingJobId}:`, error);
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

  /**
   * Get initial grading job status
   */
  private async getInitialGradingJobStatus(
    gradingJobId: number,
  ): Promise<MessageEvent> {
    const job = await this.getGradingJob(gradingJobId);

    if (!job) {
      throw new Error(`Grading job with ID ${gradingJobId} not found.`);
    }

    return {
      type: "update",
      data: {
        timestamp: new Date().toISOString(),
        status: job.status,
        progress: job.progress,
        percentage: job.percentage || 0,
        result: job.result ? JSON.parse(job.result as string) : undefined,
        done: job.status === "Completed" || job.status === "Failed",
      },
    } as unknown as MessageEvent;
  }

  /**
   * Poll grading job status
   */
  private async pollGradingJobStatus(
    gradingJobId: number,
  ): Promise<MessageEvent | null> {
    const job = await this.getGradingJob(gradingJobId);

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
        result: job.result ? JSON.parse(job.result as string) : undefined,
        done: job.status === "Completed" || job.status === "Failed",
      },
    } as unknown as MessageEvent;
  }

  /**
   * Emit grading job status update
   */
  private emitGradingJobStatusUpdate(
    gradingJobId: number,
    statusUpdate: {
      status: string;
      progress: string;
      percentage?: number;
      result?: any;
    },
  ): void {
    const subject = this.gradingJobStreams.get(gradingJobId);
    if (subject) {
      let messageType = "update";
      if (statusUpdate.status === "Completed") {
        messageType = "finalize";
      } else if (statusUpdate.status === "Failed") {
        messageType = "error";
      }

      subject.next({
        type: messageType,
        data: {
          timestamp: new Date().toISOString(),
          ...statusUpdate,
          result: statusUpdate.result
            ? JSON.stringify(statusUpdate.result)
            : undefined,
          done:
            statusUpdate.status === "Completed" ||
            statusUpdate.status === "Failed",
        },
      } as unknown as MessageEvent);

      if (
        statusUpdate.status === "Completed" ||
        statusUpdate.status === "Failed"
      ) {
        setTimeout(() => {
          void this.cleanupGradingJobStream(gradingJobId);
        }, 1000);
      }
    }
  }

  /**
   * Cleanup grading job stream
   */
  async cleanupGradingJobStream(gradingJobId: number): Promise<void> {
    const subject = this.gradingJobStreams.get(gradingJobId);
    if (subject) {
      subject.complete();
      this.gradingJobStreams.delete(gradingJobId);
    }
  }

  /**
   * Submit feedback for an assignment attempt
   */
  async submitFeedback(
    assignmentId: number,
    attemptId: number,
    feedbackDto: AssignmentFeedbackDto,
    userSession: UserSession,
  ): Promise<AssignmentFeedbackResponseDto> {
    return this.feedbackService.submitFeedback(
      assignmentId,
      attemptId,
      feedbackDto,
      userSession,
    );
  }
  async updateAssignmentAttemptWithSSE(
    attemptId: number,
    assignmentId: number,
    updateDto: LearnerUpdateAssignmentAttemptRequestDto,
    authCookie: string,
    gradingCallbackRequired: boolean,
    request: UserSessionRequest,
    response: ExpressResponse,
  ): Promise<UpdateAssignmentAttemptResponseDto> {
    // Send periodic heartbeat to keep connection alive
    const heartbeatInterval = setInterval(() => {
      response.write(`:heartbeat\n\n`);
    }, 30_000); // Every 30 seconds

    try {
      const result = await this.submissionService.updateAssignmentAttempt(
        attemptId,
        assignmentId,
        updateDto,
        authCookie,
        gradingCallbackRequired,
        request,
      );

      clearInterval(heartbeatInterval);
      return result;
    } catch (error) {
      clearInterval(heartbeatInterval);
      throw error;
    }
  }

  /**
   * Get feedback for an assignment attempt
   */
  async getFeedback(
    assignmentId: number,
    attemptId: number,
    userSession: UserSession,
  ): Promise<AssignmentFeedbackDto> {
    return this.feedbackService.getFeedback(
      assignmentId,
      attemptId,
      userSession,
    );
  }

  /**
   * Process a regrading request
   */
  async processRegradingRequest(
    assignmentId: number,
    attemptId: number,
    regradingRequestDto: RegradingRequestDto,
    userSession: UserSession,
  ): Promise<RequestRegradingResponseDto> {
    return this.regradingService.processRegradingRequest(
      assignmentId,
      attemptId,
      regradingRequestDto,
      userSession,
    );
  }

  /**
   * Get regrading status
   */
  async getRegradingStatus(
    assignmentId: number,
    attemptId: number,
    userSession: UserSession,
  ): Promise<RegradingStatusResponseDto> {
    return this.regradingService.getRegradingStatus(
      assignmentId,
      attemptId,
      userSession,
    );
  }

  /**
   * List assignment attempts
   */
  async listAssignmentAttempts(
    assignmentId: number,
    userSession: UserSession,
  ): Promise<AssignmentAttemptResponseDto[]> {
    return this.prisma.assignmentAttempt.findMany({
      where:
        userSession.role === UserRole.AUTHOR
          ? { assignmentId }
          : { assignmentId, userId: userSession.userId },
    });
  }

  /**
   * Create an assignment attempt
   */
  async createAssignmentAttempt(
    assignmentId: number,
    userSession: UserSession,
  ): Promise<BaseAssignmentAttemptResponseDto> {
    return this.submissionService.createAssignmentAttempt(
      assignmentId,
      userSession,
    );
  }

  /**
   * Update an assignment attempt
   */
  async updateAssignmentAttempt(
    attemptId: number,
    assignmentId: number,
    updateDto: LearnerUpdateAssignmentAttemptRequestDto,
    authCookie: string,
    gradingCallbackRequired: boolean,
    request: UserSessionRequest,
  ): Promise<UpdateAssignmentAttemptResponseDto> {
    return this.submissionService.updateAssignmentAttempt(
      attemptId,
      assignmentId,
      updateDto,
      authCookie,
      gradingCallbackRequired,
      request,
    );
  }

  /**
   * Get a learner assignment attempt
   */
  async getLearnerAssignmentAttempt(
    attemptId: number,
  ): Promise<GetAssignmentAttemptResponseDto> {
    return this.submissionService.getLearnerAssignmentAttempt(attemptId);
  }

  /**
   * Get an assignment attempt
   */
  async getAssignmentAttempt(
    attemptId: number,
    language?: string,
  ): Promise<GetAssignmentAttemptResponseDto> {
    return this.submissionService.getAssignmentAttempt(attemptId, language);
  }

  /**
   * Create a report
   */
  async createReport(
    assignmentId: number,
    attemptId: number,
    issueType: ReportType,
    description: string,
    userId: string,
  ): Promise<void> {
    return this.reportingService.createReport(
      assignmentId,
      attemptId,
      issueType,
      description,
      userId,
    );
  }
}
