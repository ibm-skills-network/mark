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
  private progressCallbacks = new Map<number, ProgressUpdateCallback>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: AdminEmailService,
  ) {}

  /**
   * Register a callback for progress updates
   */
  setProgressCallback(
    attemptId: number,
    callback: ProgressUpdateCallback,
  ): void {
    this.progressCallbacks.set(attemptId, callback);
    this.logger.log(`Registered progress callback for attempt ${attemptId}`);
  }

  /**
   * Remove progress callback
   */
  removeProgressCallback(attemptId: number): void {
    this.progressCallbacks.delete(attemptId);
    this.logger.log(`Removed progress callback for attempt ${attemptId}`);
  }

  /**
   * Initialize grading progress for an attempt
   */
  async initializeProgress(
    attemptId: number,
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

      const callback = this.progressCallbacks.get(attemptId);
      if (callback) {
        await callback("Processing", "Initializing grading process...", 0);
      }
    } catch (error) {
      this.logger.error(
        `Failed to initialize progress for attempt ${attemptId}`,
        error,
      );
    }
  }

  /**
   * Update grading progress
   */
  async updateProgress(
    attemptId: number,
    update: GradingProgressUpdate,
  ): Promise<void> {
    try {
      await this.prisma.gradingProgress.update({
        where: { attemptId },
        data: update,
      });

      const callback = this.progressCallbacks.get(attemptId);
      if (callback && update.currentStage) {
        await callback("Processing", update.currentStage, update.progress);
      }
    } catch (error) {
      this.logger.error(
        `Failed to update progress for attempt ${attemptId}`,
        error,
      );
    }
  }

  /**
   * Update progress for a specific question
   */
  async updateQuestionProgress(
    attemptId: number,
    questionNumber: number,
    totalQuestions: number,
    stage: string,
  ): Promise<void> {
    // Grading questions takes up 90% of progress, reserve 10% for finalizing
    const progress = Math.round((questionNumber / totalQuestions) * 90);

    await this.updateProgress(attemptId, {
      currentQuestion: questionNumber,
      currentStage: stage,
      progress,
    });
  }

  /**
   * Mark grading as complete
   */
  async markComplete(attemptId: number): Promise<void> {
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

      this.removeProgressCallback(attemptId);

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
        `Failed to mark grading complete for attempt ${attemptId}`,
        error,
      );
    }
  }

  /**
   * Mark grading as failed
   */
  async markFailed(attemptId: number, error: string): Promise<void> {
    try {
      await this.prisma.gradingProgress.update({
        where: { attemptId },
        data: {
          status: GradingStatus.FAILED,
          error,
          completedAt: new Date(),
        },
      });
    } catch (error_) {
      this.logger.error(
        `Failed to mark grading as failed for attempt ${attemptId}`,
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
