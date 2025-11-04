/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable unicorn/no-null */
/* eslint-disable @typescript-eslint/require-await */
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { GradingJob, RegradingStatus, ReportType } from "@prisma/client";
import { Response as ExpressResponse } from "express";
import { catchError, Observable, of, Subject } from "rxjs";
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
import { EmailService } from "../../../common/services/email.service";
import { PrismaService } from "../../../database/prisma.service";
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
    private readonly emailService: EmailService,
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
    const gradingJob = await this.prisma.gradingJob.create({
      data: {
        attemptId: null,
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
      await this.updateGradingJobStatus(gradingJobId, {
        status: "Processing",
        progress: "Starting author preview grading...",
        percentage: 0,
      });

      const result = await this.submissionService.updateAssignmentAttempt(
        -1,
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

      await this.updateGradingJobStatus(gradingJobId, {
        status: "Completed",
        progress: "Grading completed successfully",
        percentage: 100,
        result,
      });
    } catch (error) {
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

    this.emitGradingJobStatusUpdate(gradingJobId, statusUpdate);
  }

  /**
   * Get grading job status stream with improved reliability
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

    let lastUpdateTime = Date.now();
    let heartbeatInterval: NodeJS.Timeout;
    let isStreamActive = true;

    return new Observable<MessageEvent>((subscriber) => {
      subscriber.next({
        type: "update",
        data: JSON.stringify({
          message: "Connected to grading service...",
          timestamp: new Date().toISOString(),
          connectionId: `${gradingJobId}-${Date.now()}`,
        }),
      } as MessageEvent);

      heartbeatInterval = setInterval(() => {
        if (isStreamActive && Date.now() - lastUpdateTime > 15_000) {
          subscriber.next({
            type: "heartbeat",
            data: JSON.stringify({
              heartbeat: true,
              timestamp: new Date().toISOString(),
              jobId: gradingJobId,
            }),
          } as MessageEvent);
        }
      }, 10_000);
      this.getInitialGradingJobStatus(gradingJobId)
        .then((initialEvent) => {
          if (initialEvent && isStreamActive) {
            lastUpdateTime = Date.now();
            subscriber.next(initialEvent);
          }
        })
        .catch((error) => {
          subscriber.next({
            type: "error",
            data: JSON.stringify({
              error: "Failed to get initial job status",
              retryable: true,
              timestamp: new Date().toISOString(),
            }),
          } as MessageEvent);
        });

      let pollInterval = 2000;
      let consecutiveErrors = 0;
      const maxPollInterval = 15_000;

      const pollJob = async () => {
        if (!isStreamActive) return;

        try {
          const statusEvent = await this.pollGradingJobStatus(gradingJobId);

          if (statusEvent && isStreamActive) {
            lastUpdateTime = Date.now();
            consecutiveErrors = 0;
            pollInterval = Math.max(2000, pollInterval - 1000);

            subscriber.next(statusEvent);

            const status = (statusEvent as { data?: { status?: string } })?.data
              ?.status;

            if (status === "Completed" || status === "Failed") {
              isStreamActive = false;

              setTimeout(() => {
                subscriber.next({
                  type: "finalize",
                  data: JSON.stringify({
                    status: "Stream completed",
                    finalStatus: status,
                    timestamp: new Date().toISOString(),
                  }),
                } as MessageEvent);
                subscriber.complete();
              }, 500);
              return;
            }
          }
        } catch {
          consecutiveErrors++;
          pollInterval = Math.min(maxPollInterval, pollInterval + 2000);

          if (consecutiveErrors >= 3) {
            subscriber.next({
              type: "error",
              data: JSON.stringify({
                error: "Multiple polling failures detected",
                consecutiveErrors,
                nextRetryIn: pollInterval,
                timestamp: new Date().toISOString(),
              }),
            } as MessageEvent);
          }

          if (consecutiveErrors >= 10) {
            isStreamActive = false;
            subscriber.error(
              new Error(
                `Job ${gradingJobId} monitoring failed after ${consecutiveErrors} consecutive errors`,
              ),
            );
            return;
          }
        }

        if (isStreamActive) {
          setTimeout(() => void pollJob(), pollInterval);
        }
      };

      setTimeout(() => void pollJob(), 1000);

      const statusSubscription = statusSubject.asObservable().subscribe({
        next: (event) => {
          if (isStreamActive) {
            lastUpdateTime = Date.now();
            subscriber.next(event);
          }
        },
        error: (error) => {
          if (isStreamActive) {
            subscriber.next({
              type: "error",
              data: JSON.stringify({
                error: "Internal status update failed",
                details: error instanceof Error ? error.message : String(error),
                timestamp: new Date().toISOString(),
              }),
            } as MessageEvent);
          }
        },
      });

      return () => {
        isStreamActive = false;

        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
        }

        statusSubscription.unsubscribe();
        void this.cleanupGradingJobStream(gradingJobId);
      };
    }).pipe(
      catchError((error: Error) => {
        return of({
          type: "error",
          data: JSON.stringify({
            error: "Stream connection failed",
            details: error.message,
            timestamp: new Date().toISOString(),
            jobId: gradingJobId,
          }),
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
   * Poll grading job status with enhanced error handling
   */
  private async pollGradingJobStatus(
    gradingJobId: number,
  ): Promise<MessageEvent | null> {
    try {
      const job = await this.getGradingJob(gradingJobId);

      if (!job) {
        return {
          type: "error",
          data: JSON.stringify({
            error: "Grading job not found",
            jobId: gradingJobId,
            timestamp: new Date().toISOString(),
            retryable: false,
          }),
        } as MessageEvent;
      }

      let messageType = "update";
      if (job.status === "Completed") {
        messageType = "finalize";
      } else if (job.status === "Failed") {
        messageType = "error";
      }

      let parsedResult: any;
      try {
        parsedResult = job.result
          ? JSON.parse(job.result as string)
          : undefined;
      } catch {
        parsedResult = {
          error: "Result parsing failed",
          rawResult: job.result,
        };
      }

      return {
        type: messageType,
        data: JSON.stringify({
          timestamp: new Date().toISOString(),
          status: job.status,
          progress: job.progress || "Processing...",
          percentage: job.percentage || 0,
          result: parsedResult,
          jobId: gradingJobId,
          done: job.status === "Completed" || job.status === "Failed",
        }),
      } as MessageEvent;
    } catch (error) {
      throw new Error(
        `Database error while polling job ${gradingJobId}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
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

  /**
   * Update individual question grades for an attempt (author only)
   */
  async updateQuestionGrades(
    assignmentId: number,
    attemptId: number,
    questionGrades: Record<string, number>,
    regradingRequestId: number | undefined,
    userSession: UserSession,
  ) {
    const attempt = await this.prisma.assignmentAttempt.findFirst({
      where: {
        id: attemptId,
        assignmentId,
      },
      include: {
        questionResponses: true,
      },
    });

    if (!attempt) {
      throw new NotFoundException(
        `Attempt ${attemptId} not found for assignment ${assignmentId}`,
      );
    }

    const authorAssignment = await this.prisma.assignmentAuthor.findFirst({
      where: {
        assignmentId,
        userId: userSession.userId,
      },
    });

    if (!authorAssignment && userSession.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        "You do not have permission to modify grades for this assignment",
      );
    }

    const updatePromises = Object.entries(questionGrades).map(
      async ([questionResponseId, newPoints]) => {
        const responseId = Number(questionResponseId);

        const response = attempt.questionResponses.find(
          (r) => r.id === responseId,
        );
        if (!response) {
          throw new NotFoundException(
            `Question response ${responseId} not found in attempt ${attemptId}`,
          );
        }

        return this.prisma.questionResponse.update({
          where: { id: responseId },
          data: { points: newPoints },
        });
      },
    );

    await Promise.all(updatePromises);

    const updatedResponses = await this.prisma.questionResponse.findMany({
      where: { assignmentAttemptId: attemptId },
    });

    const questionIds = updatedResponses.map((r) => r.questionId);
    const questions = await this.prisma.question.findMany({
      where: { id: { in: questionIds } },
      select: {
        id: true,
        totalPoints: true,
      },
    });

    const questionPointsMap = new Map(
      questions.map((q) => [q.id, q.totalPoints]),
    );

    const totalPossiblePoints = updatedResponses.reduce(
      (sum, r) => sum + (questionPointsMap.get(r.questionId) || 0),
      0,
    );

    const totalEarnedPoints = updatedResponses.reduce(
      (sum, r) => sum + r.points,
      0,
    );

    const newGrade =
      totalPossiblePoints > 0 ? totalEarnedPoints / totalPossiblePoints : 0;

    const oldGrade = attempt.grade || 0;

    await this.prisma.assignmentAttempt.update({
      where: { id: attemptId },
      data: { grade: newGrade },
    });

    if (regradingRequestId) {
      await this.prisma.regradingRequest.update({
        where: { id: regradingRequestId },
        data: { regradingStatus: RegradingStatus.COMPLETED },
      });

      await this.sendGradeUpdateNotification(
        assignmentId,
        attemptId,
        attempt.userId,
        oldGrade,
        newGrade,
      );
    }

    return {
      success: true,
      attemptId,
      updatedGrade: newGrade * 100,
      totalPoints: totalPossiblePoints,
      earnedPoints: totalEarnedPoints,
      questionsUpdated: Object.keys(questionGrades).length,
    };
  }

  /**
   * Send email notification to learner about grade update
   * @private
   */
  private async sendGradeUpdateNotification(
    assignmentId: number,
    attemptId: number,
    learnerUserId: string,
    oldGrade: number,
    newGrade: number,
  ): Promise<void> {
    try {
      const assignment = await this.prisma.assignment.findUnique({
        where: { id: assignmentId },
        select: { name: true },
      });

      if (!assignment) {
        return;
      }

      const learnerEmail = learnerUserId;

      await this.emailService.sendGradeUpdateNotification(
        learnerEmail,
        assignment.name,
        assignmentId,
        attemptId,
        oldGrade,
        newGrade,
        "COMPLETED",
      );
    } catch {
      // Handle error
    }
  }
}
