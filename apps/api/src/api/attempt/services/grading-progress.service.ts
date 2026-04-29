import { Injectable, Logger } from "@nestjs/common";
import { GradingStatus } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";
import { AdminEmailService } from "../../../auth/services/admin-email.service";

export interface GradingProgressUpdate {
  currentQuestion?: number;
  totalQuestions?: number;
  currentStage?: string;
  progress?: number;
  status?: GradingStatus;
  error?: string;
}

export type ProgressUpdateCallback = (
  status: string,
  progress: string,
  percentage?: number,
) => Promise<void>;

@Injectable()
export class GradingProgressService {
  private readonly logger = new Logger(GradingProgressService.name);
  private progressCallbacks = new Map<string, ProgressUpdateCallback>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: AdminEmailService,
  ) {}

  /**
   * Compose the Map key for a callback. The composite (attemptId, jobId) shape
   * disambiguates concurrent grading runs for the same attemptId — for example,
   * an admin-fired regrade while the original learner grading is still in flight.
   * Without this, the second registration silently overwrites the first and the
   * original SSE stream receives the wrong job's events.
   */
  private buildCallbackKey(attemptId: number, jobId: string): string {
    return `${attemptId}:${jobId}`;
  }

  /**
   * Register a callback for progress updates
   */
  setProgressCallback(
    attemptId: number,
    jobId: string,
    callback: ProgressUpdateCallback,
  ): void {
    const key = this.buildCallbackKey(attemptId, jobId);
    this.progressCallbacks.set(key, callback);
    this.logger.log(
      `Registered progress callback for attempt ${attemptId} job ${jobId}`,
    );
  }

  /**
   * Remove progress callback
   */
  removeProgressCallback(attemptId: number, jobId: string): void {
    const key = this.buildCallbackKey(attemptId, jobId);
    this.progressCallbacks.delete(key);
    this.logger.log(
      `Removed progress callback for attempt ${attemptId} job ${jobId}`,
    );
  }

  /**
   * Initialize grading progress for an attempt
   */
  async initializeProgress(
    attemptId: number,
    jobId: string,
    totalQuestions: number,
  ): Promise<void> {
    try {
      await this.prisma.gradingProgress.upsert({
        where: { attemptId },
        create: {
          attemptId,
          totalQuestions,
          status: GradingStatus.PROCESSING,
          progress: 0,
          currentQuestion: 0,
        },
        update: {
          status: GradingStatus.PROCESSING,
          progress: 0,
          currentQuestion: 0,
          totalQuestions,
          error: null,
          currentStage: "Initializing grading process...",
        },
      });

      const callback = this.progressCallbacks.get(
        this.buildCallbackKey(attemptId, jobId),
      );
      if (callback) {
        await callback("Processing", "Initializing grading process...", 0);
      }
    } catch (error) {
      this.logger.error(
        `Failed to initialize progress for attempt ${attemptId} job ${jobId}`,
        error,
      );
    }
  }

  /**
   * Update grading progress
   */
  async updateProgress(
    attemptId: number,
    jobId: string,
    update: GradingProgressUpdate,
  ): Promise<void> {
    try {
      await this.prisma.gradingProgress.update({
        where: { attemptId },
        data: update,
      });

      const callback = this.progressCallbacks.get(
        this.buildCallbackKey(attemptId, jobId),
      );
      if (callback && update.currentStage) {
        await callback("Processing", update.currentStage, update.progress);
      }
    } catch (error) {
      this.logger.error(
        `Failed to update progress for attempt ${attemptId} job ${jobId}`,
        error,
      );
    }
  }

  /**
   * Update progress for a specific question
   */
  async updateQuestionProgress(
    attemptId: number,
    jobId: string,
    questionNumber: number,
    totalQuestions: number,
    stage: string,
  ): Promise<void> {
    // Grading questions takes up 90% of progress, reserve 10% for finalizing
    const progress = Math.round((questionNumber / totalQuestions) * 90);

    await this.updateProgress(attemptId, jobId, {
      currentQuestion: questionNumber,
      currentStage: stage,
      progress,
    });
  }

  /**
   * Mark grading as complete
   */
  async markComplete(attemptId: number, jobId: string): Promise<void> {
    try {
      const gradingProgress = await this.prisma.gradingProgress.findUnique({
        where: { attemptId },
        include: {
          attempt: true,
        },
      });

      await this.prisma.gradingProgress.update({
        where: { attemptId },
        data: {
          status: GradingStatus.COMPLETED,
          progress: 100,
          currentStage: "Grading complete!",
          completedAt: new Date(),
        },
      });

      this.removeProgressCallback(attemptId, jobId);

      if (
        gradingProgress?.notifyOnComplete &&
        gradingProgress.notificationEmail
      ) {
        this.logger.log(
          `Sending grading completion email for attempt ${attemptId} to ${gradingProgress.notificationEmail}`,
        );

        try {
          const assignmentId = gradingProgress.attempt.assignmentId;
          const grade = gradingProgress.attempt.grade
            ? gradingProgress.attempt.grade * 100
            : undefined;

          await this.emailService.sendGradingCompletionEmail(
            gradingProgress.notificationEmail,
            assignmentId,
            attemptId,
            grade,
          );

          this.logger.log(
            `Successfully sent grading completion email for attempt ${attemptId}`,
          );
        } catch (emailError) {
          this.logger.error(
            `Failed to send grading completion email for attempt ${attemptId}`,
            emailError,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to mark grading complete for attempt ${attemptId} job ${jobId}`,
        error,
      );
    }
  }

  /**
   * Mark grading as failed
   */
  async markFailed(
    attemptId: number,
    jobId: string,
    error: string,
  ): Promise<void> {
    try {
      await this.prisma.gradingProgress.update({
        where: { attemptId },
        data: {
          status: GradingStatus.FAILED,
          error,
          completedAt: new Date(),
        },
      });

      // Symmetric cleanup with markComplete: without this, a failed grading
      // leaves the callback resident in the Map until process restart. The
      // double-remove on the worker's outer-catch failure path is a no-op
      // because Map.delete on an absent key returns false.
      this.removeProgressCallback(attemptId, jobId);
    } catch (error_) {
      this.logger.error(
        `Failed to mark grading as failed for attempt ${attemptId} job ${jobId}`,
        error_,
      );
    }
  }

  /**
   * Get grading progress for an attempt
   */
  async getProgress(attemptId: number) {
    return this.prisma.gradingProgress.findUnique({
      where: { attemptId },
    });
  }

  /**
   * Enable email notification for grading completion
   */
  async enableEmailNotification(
    attemptId: number,
    email: string,
  ): Promise<void> {
    try {
      await this.prisma.gradingProgress.update({
        where: { attemptId },
        data: {
          notifyOnComplete: true,
          notificationEmail: email,
        },
      });
      this.logger.log(
        `Email notification enabled for attempt ${attemptId} to ${email}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to enable email notification for attempt ${attemptId}`,
        error,
      );
      throw error;
    }
  }
}
