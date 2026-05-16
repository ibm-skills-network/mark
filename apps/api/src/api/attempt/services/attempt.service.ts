/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable unicorn/no-null */
/* eslint-disable @typescript-eslint/require-await */
import { Inject, Injectable } from "@nestjs/common";
import { ReportType } from "@prisma/client";
import { Response as ExpressResponse } from "express";
import { Observable } from "rxjs";
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
import { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import { CreateQuestionResponseAttemptResponseDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import { randomUUID } from "node:crypto";
import {
  UserRole,
  UserSession,
  UserSessionRequest,
} from "../../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../../database/prisma.service";
import {
  JOB_NAMES,
  JOB_QUEUE_NAMES,
} from "../../../job-queue/job-queue.constants";
import { JobQueueService } from "../../../job-queue/job-queue.service";
import { JobStateService } from "../../../job-queue/job-state.service";
import { JobStateRecord } from "../../../job-queue/job-state.types";
import { AttemptFeedbackService } from "./attempt-feedback.service";
import { AttemptRegradingService } from "./attempt-regrading.service";
import { AttemptReportingService } from "./attempt-reporting.service";
import { AttemptSubmissionService } from "./attempt-submission.service";
import { newJobScopedCache } from "./grading/job-scoped-cache";
import {
  GradingProgressService,
  type GradingProgressDetails,
} from "./grading-progress.service";

@Injectable()
export class AttemptServiceV2 {
  constructor(
    private readonly prisma: PrismaService,
    private readonly submissionService: AttemptSubmissionService,
    private readonly feedbackService: AttemptFeedbackService,
    private readonly regradingService: AttemptRegradingService,
    private readonly reportingService: AttemptReportingService,
    private readonly jobStateService: JobStateService,
    private readonly jobQueueService: JobQueueService,
    @Inject("GradingProgressService")
    private readonly gradingProgressService?: GradingProgressService,
  ) {}

  private buildGradingActiveKey(
    userId: string,
    assignmentId: number,
    attemptId: number | null,
  ): string {
    return [
      "grading",
      userId,
      String(assignmentId),
      attemptId === null ? "author-preview" : String(attemptId),
    ].join(":");
  }

  /**
   * Create a grading job for author preview (no attemptId)
   */
  async createAuthorGradingJob(
    assignmentId: number,
    _updateDto: LearnerUpdateAssignmentAttemptRequestDto,
    _authCookie: string,
    request: UserSessionRequest,
  ): Promise<{ gradingJobId: string; message: string }> {
    void _updateDto;
    void _authCookie;
    const activeKey = this.buildGradingActiveKey(
      request.userSession.userId,
      assignmentId,
      null,
    );
    const temporaryJobId = randomUUID();
    const existingJobId = await this.jobStateService.acquireActiveJobLock(
      activeKey,
      temporaryJobId,
    );

    if (existingJobId !== null) {
      return {
        gradingJobId: existingJobId,
        message:
          "Author preview job is already in progress. Reusing existing job.",
      };
    }

    const gradingJob = await this.jobStateService.createJob({
      queueName: JOB_QUEUE_NAMES.ATTEMPT,
      jobName: JOB_NAMES.ATTEMPT_AUTHOR_PREVIEW,
      kind: "attempt-author-preview",
      attemptId: null,
      assignmentId,
      userId: request.userSession.userId,
      status: "Pending",
      progress: "Author preview job created",
      activeKey,
      reservedId: temporaryJobId,
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
    _updateDto: LearnerUpdateAssignmentAttemptRequestDto,
    _authCookie: string,
    request: UserSessionRequest,
  ): Promise<{ gradingJobId: string; message: string }> {
    void _updateDto;
    void _authCookie;
    const activeKey = this.buildGradingActiveKey(
      request.userSession.userId,
      assignmentId,
      attemptId,
    );
    const temporaryJobId = randomUUID();
    const existingJobId = await this.jobStateService.acquireActiveJobLock(
      activeKey,
      temporaryJobId,
    );

    if (existingJobId !== null) {
      return {
        gradingJobId: existingJobId,
        message:
          "A grading job is already running for this attempt. Reusing existing job.",
      };
    }

    const gradingJob = await this.jobStateService.createJob({
      queueName: JOB_QUEUE_NAMES.ATTEMPT,
      jobName: JOB_NAMES.ATTEMPT_GRADE,
      kind: "attempt-grading",
      attemptId,
      assignmentId,
      userId: request.userSession.userId,
      status: "Pending",
      progress: "Grading job created",
      activeKey,
      reservedId: temporaryJobId,
    });

    return {
      gradingJobId: gradingJob.id,
      message: "Grading job created. Use the SSE endpoint to track progress.",
    };
  }

  async enqueueGradingJob(
    gradingJobId: string,
    attemptId: number,
    assignmentId: number,
    updateDto: LearnerUpdateAssignmentAttemptRequestDto,
    authCookie: string,
    request: UserSessionRequest,
  ): Promise<void> {
    try {
      await this.jobQueueService.enqueue(
        JOB_QUEUE_NAMES.ATTEMPT,
        JOB_NAMES.ATTEMPT_GRADE,
        {
          assignmentId,
          attemptId,
          gradingJobId,
          updateDto,
          userSession: {
            gradingCallbackRequired:
              request.userSession.gradingCallbackRequired,
            role: request.userSession.role,
            userId: request.userSession.userId,
          },
          ...(request.userSession.gradingCallbackRequired && authCookie
            ? { authCookie }
            : {}),
        },
        {
          jobId: gradingJobId,
        },
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      await this.updateGradingJobStatus(gradingJobId, {
        status: "Failed",
        progress: `Failed to enqueue grading job: ${errorMessage}`,
        percentage: 0,
      });
      throw error;
    }
  }

  async enqueueAuthorPreviewJob(
    gradingJobId: string,
    assignmentId: number,
    updateDto: LearnerUpdateAssignmentAttemptRequestDto,
    _authCookie: string,
    request: UserSessionRequest,
  ): Promise<void> {
    void _authCookie;
    try {
      await this.jobQueueService.enqueue(
        JOB_QUEUE_NAMES.ATTEMPT,
        JOB_NAMES.ATTEMPT_AUTHOR_PREVIEW,
        {
          assignmentId,
          gradingJobId,
          updateDto,
          userSession: {
            gradingCallbackRequired:
              request.userSession.gradingCallbackRequired,
            role: request.userSession.role,
            userId: request.userSession.userId,
          },
        },
        {
          jobId: gradingJobId,
        },
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      await this.updateGradingJobStatus(gradingJobId, {
        status: "Failed",
        progress: `Failed to enqueue author preview job: ${errorMessage}`,
        percentage: 0,
      });
      throw error;
    }
  }

  /**
   * Process author preview job asynchronously
   */
  async processAuthorPreviewJob(
    gradingJobId: string,
    assignmentId: number,
    updateDto: LearnerUpdateAssignmentAttemptRequestDto,
    authCookie: string,
    request: UserSessionRequest,
  ): Promise<void> {
    try {
      const cache = newJobScopedCache();

      await this.updateGradingJobStatus(gradingJobId, {
        status: "Processing",
        progress: "Starting author preview grading...",
        percentage: 0,
      });

      if (this.gradingProgressService) {
        this.gradingProgressService.setProgressCallback(
          -1,
          async (
            status: string,
            progress: string,
            percentage?: number,
            details?: GradingProgressDetails,
          ) => {
            await this.updateGradingJobStatus(gradingJobId, {
              status,
              progress,
              percentage: percentage ?? 0,
              result: details ? { gradingState: details } : undefined,
            });
          },
        );
      }

      const result = await this.submissionService.updateAssignmentAttempt(
        -1,
        assignmentId,
        updateDto,
        authCookie,
        false,
        request,
        async (
          progress: string,
          percentage?: number,
          details?: GradingProgressDetails,
        ) => {
          await this.updateGradingJobStatus(gradingJobId, {
            status: "Processing",
            progress,
            percentage: percentage || 0,
            result: details ? { gradingState: details } : undefined,
          });
        },
        cache,
      );

      if (this.gradingProgressService) {
        this.gradingProgressService.removeProgressCallback(-1);
      }

      await this.updateGradingJobStatus(gradingJobId, {
        status: "Completed",
        progress: "Author preview completed successfully",
        percentage: 100,
        result,
      });
    } catch (error) {
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
    gradingJobId: string,
    attemptId: number,
    assignmentId: number,
    updateDto: LearnerUpdateAssignmentAttemptRequestDto,
    authCookie: string,
    request: UserSessionRequest,
  ): Promise<void> {
    try {
      const cache = newJobScopedCache();

      if (this.gradingProgressService) {
        this.gradingProgressService.setProgressCallback(
          attemptId,
          async (
            status: string,
            progress: string,
            percentage?: number,
            details?: GradingProgressDetails,
          ) => {
            await this.updateGradingJobStatus(gradingJobId, {
              status,
              progress,
              percentage,
              result: details ? { gradingState: details } : undefined,
            });
          },
        );
      }

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
        async (
          progress: string,
          percentage?: number,
          details?: GradingProgressDetails,
        ) => {
          await this.updateGradingJobStatus(gradingJobId, {
            status: "Processing",
            progress,
            percentage,
            result: details ? { gradingState: details } : undefined,
          });
        },
        cache,
      );

      await this.updateGradingJobStatus(gradingJobId, {
        status: "Completed",
        progress: "Grading completed successfully",
        percentage: 100,
        result,
      });

      if (this.gradingProgressService) {
        this.gradingProgressService.removeProgressCallback(attemptId);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      await this.updateGradingJobStatus(gradingJobId, {
        status: "Failed",
        progress: `Grading failed: ${errorMessage}`,
        percentage: 0,
      });

      if (this.gradingProgressService) {
        this.gradingProgressService.removeProgressCallback(attemptId);
        // Guard against author preview jobs which use attemptId = -1
        if (attemptId > 0) {
          await this.gradingProgressService.markFailed(attemptId, errorMessage);
        }
      }
      throw error;
    }
  }

  /**
   * Get grading job by ID
   */
  async getGradingJob(gradingJobId: string): Promise<JobStateRecord | null> {
    return this.jobStateService.getJob(gradingJobId);
  }

  /**
   * Update grading job status
   */
  async updateGradingJobStatus(
    gradingJobId: string,
    statusUpdate: {
      status: string;
      progress: string;
      percentage?: number;
      result?: any;
    },
  ): Promise<void> {
    await this.jobStateService.updateJobStatus(gradingJobId, statusUpdate);
  }

  /**
   * Get grading job status stream with improved reliability
   */
  getGradingJobStatusStream(gradingJobId: string): Observable<MessageEvent> {
    return this.jobStateService.getJobStatusStream(gradingJobId);
  }

  /**
   * Cleanup grading job stream
   */
  async cleanupGradingJobStream(gradingJobId: string): Promise<void> {
    await this.jobStateService.cleanupJobStream(gradingJobId);
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
    const heartbeatInterval = setInterval(() => {
      response.write(`:heartbeat\n\n`);
    }, 30_000);

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
   * Abandon a stale (no-progress, version-mismatched) attempt
   */
  async abandonAssignmentAttempt(
    attemptId: number,
    userSession: UserSession,
  ): Promise<{ id: number; success: true }> {
    return this.submissionService.abandonAssignmentAttempt(
      attemptId,
      userSession,
    );
  }

  async autoSaveQuestionResponse(
    attemptId: number,
    assignmentId: number,
    questionId: number,
    requestDto: CreateQuestionResponseAttemptRequestDto,
    userSession: UserSession,
    language: string,
  ): Promise<CreateQuestionResponseAttemptResponseDto> {
    return this.submissionService.autoSaveQuestionResponse(
      attemptId,
      assignmentId,
      questionId,
      requestDto,
      userSession,
      language,
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
    userSession: UserSession,
  ): Promise<GetAssignmentAttemptResponseDto> {
    return this.submissionService.getLearnerAssignmentAttempt(
      attemptId,
      userSession,
    );
  }

  /**
   * Get an assignment attempt
   */
  async getAssignmentAttempt(
    attemptId: number,
    userSession: UserSession,
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
