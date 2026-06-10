import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { GradingStatus } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";
import { AdminEmailService } from "../../../auth/services/admin-email.service";

export type QuestionGradingStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed";

/**
 * Question types whose grading runs noticeably longer (file ingest, transcript
 * generation, vision). The frontend uses the flag to show a "hang in there"
 * hint when one of these is in flight.
 */
export type SlowGradingType =
  | "UPLOAD"
  | "LINK_FILE"
  | "URL"
  | "PRESENTATION"
  | "VIDEO_PRESENTATION";

export interface QuestionGradingState {
  id: number;
  displayOrder: number;
  status: QuestionGradingStatus;
  slowType?: SlowGradingType;
}

export interface GradingProgressDetails {
  questions: QuestionGradingState[];
  total: number;
  completed: number;
  inFlight: number;
  failed: number;
  hasSlowInFlight: boolean;
}

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
  details?: GradingProgressDetails,
  currentQuestion?: number,
  totalQuestions?: number,
) => Promise<void>;

@Injectable()
export class GradingProgressService {
  private readonly logger = new Logger(GradingProgressService.name);
  private isCleaningStaleAiFeedbackReruns = false;
  private progressCallbacks = new Map<number, ProgressUpdateCallback>();
  private perQuestionState = new Map<
    number,
    Map<number, QuestionGradingState>
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: AdminEmailService,
  ) {}

  private areSchedulersEnabled(): boolean {
    return process.env.ENABLE_JOB_SCHEDULERS === "true";
  }

  private getStaleAiFeedbackRerunCutoff(): Date {
    const rawMinutes = process.env.AI_FEEDBACK_RERUN_STALE_PROCESSING_MINUTES;
    const parsed = rawMinutes ? Number(rawMinutes) : 30;
    const minutes = Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
    return new Date(Date.now() - minutes * 60_000);
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async cleanupStaleAiFeedbackReruns(): Promise<number> {
    if (!this.areSchedulersEnabled()) {
      return 0;
    }

    if (this.isCleaningStaleAiFeedbackReruns) {
      this.logger.warn(
        "Skipping stale AI feedback rerun cleanup - previous run still in progress",
      );
      return 0;
    }

    this.isCleaningStaleAiFeedbackReruns = true;
    try {
      const cutoff = this.getStaleAiFeedbackRerunCutoff();
      const result = await this.prisma.gradingProgress.updateMany({
        where: {
          status: GradingStatus.PROCESSING,
          error: { not: null },
          updatedAt: { lt: cutoff },
        },
        data: {
          status: GradingStatus.COMPLETED,
          progress: 100,
          currentStage: "Grading complete!",
        },
      });

      if (result.count > 0) {
        this.logger.warn(
          `Restored ${result.count} stale AI feedback rerun lock(s) to retryable state`,
        );
      }

      return result.count;
    } catch (error) {
      this.logger.error(
        "Failed to clean up stale AI feedback rerun locks",
        error,
      );
      return 0;
    } finally {
      this.isCleaningStaleAiFeedbackReruns = false;
    }
  }

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
    this.perQuestionState.delete(attemptId);
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
      if (attemptId > 0) {
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
      }

      await this.emit(
        attemptId,
        "Processing",
        "Initializing grading process...",
        0,
      );
    } catch (error) {
      this.logger.error(
        `Failed to initialize progress for attempt ${attemptId}`,
        error,
      );
    }
  }

  /**
   * Initialize the per-question state list. Called once before grading begins.
   * Order is the display order the learner sees, not the topological one.
   */
  initializeQuestions(
    attemptId: number,
    questions: Array<
      Pick<QuestionGradingState, "id" | "displayOrder" | "slowType">
    >,
  ): void {
    const map = new Map<number, QuestionGradingState>();
    for (const q of questions) {
      map.set(q.id, {
        id: q.id,
        displayOrder: q.displayOrder,
        status: "pending",
        slowType: q.slowType,
      });
    }
    this.perQuestionState.set(attemptId, map);
  }

  /**
   * Update one question's grading state and broadcast the new snapshot.
   */
  async setQuestionStatus(
    attemptId: number,
    questionId: number,
    status: QuestionGradingStatus,
  ): Promise<void> {
    const map = this.perQuestionState.get(attemptId);
    if (!map) return;
    const existing = map.get(questionId);
    if (!existing) return;
    map.set(questionId, { ...existing, status });

    const snapshot = this.snapshot(attemptId);
    if (!snapshot) return;

    const percentage = this.computePercentage(snapshot);
    await this.emit(
      attemptId,
      "Processing",
      this.buildStageMessage(snapshot),
      percentage,
    );
  }

  /**
   * Update grading progress
   */
  async updateProgress(
    attemptId: number,
    update: GradingProgressUpdate,
  ): Promise<void> {
    try {
      if (attemptId > 0) {
        await this.prisma.gradingProgress.update({
          where: { attemptId },
          data: update,
        });
      }

      if (update.currentStage) {
        await this.emit(
          attemptId,
          "Processing",
          update.currentStage,
          update.progress,
          update.currentQuestion,
          update.totalQuestions,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to update progress for attempt ${attemptId}`,
        error,
      );
    }
  }

  /**
   * Update progress for a specific question (legacy single-question API; the
   * wave scheduler uses {@link setQuestionStatus} which yields richer state).
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
      if (attemptId > 0) {
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

        await this.maybeSendCompletionEmail(attemptId, gradingProgress);
      }

      this.removeProgressCallback(attemptId);
    } catch (error) {
      this.logger.error(
        `Failed to mark grading complete for attempt ${attemptId}`,
        error,
      );
    }
  }

  /**
   * Mark grading as complete but record that the optional AI feedback step
   * failed. The attempt itself was saved successfully — only the AI feedback
   * portion needs to be retried. Consumers can distinguish this from a hard
   * failure by checking status === COMPLETED with a non-null error.
   */
  async markCompleteWithAiFeedbackError(
    attemptId: number,
    aiFeedbackError: string,
  ): Promise<void> {
    try {
      const gradingProgress = await this.prisma.gradingProgress.findUnique({
        where: { attemptId },
        include: { attempt: true },
      });

      await this.prisma.gradingProgress.update({
        where: { attemptId },
        data: {
          status: GradingStatus.COMPLETED,
          progress: 100,
          currentStage: "Grading complete!",
          completedAt: new Date(),
          error: aiFeedbackError,
        },
      });
      this.removeProgressCallback(attemptId);
      await this.maybeSendCompletionEmail(attemptId, gradingProgress);
    } catch (updateError) {
      this.logger.error(
        `Failed to persist AI feedback error for attempt ${attemptId}`,
        updateError,
      );
      throw updateError;
    }
  }

  /**
   * Clear a previously recorded AI feedback error after a successful rerun.
   * Also restores status to COMPLETED because the rerun guard set it to
   * PROCESSING to prevent concurrent reruns.
   */
  async clearAiFeedbackError(attemptId: number): Promise<void> {
    try {
      await this.prisma.gradingProgress.update({
        where: { attemptId },
        data: { status: GradingStatus.COMPLETED, error: null },
      });
    } catch (updateError) {
      this.logger.error(
        `Failed to clear AI feedback error for attempt ${attemptId}`,
        updateError,
      );
      throw updateError;
    }
  }

  /**
   * Mark grading as failed
   */
  async markFailed(attemptId: number, error: string): Promise<void> {
    try {
      if (attemptId > 0) {
        await this.prisma.gradingProgress.update({
          where: { attemptId },
          data: {
            status: GradingStatus.FAILED,
            error,
            completedAt: new Date(),
          },
        });
      }
    } catch (error_) {
      this.logger.error(
        `Failed to mark grading as failed for attempt ${attemptId}`,
        error_,
      );
    }
  }

  private async maybeSendCompletionEmail(
    attemptId: number,
    gradingProgress: {
      notifyOnComplete: boolean;
      notificationEmail: string | null;
      attempt: { assignmentId: number; grade: number | null };
    } | null,
  ): Promise<void> {
    if (
      !gradingProgress?.notifyOnComplete ||
      !gradingProgress.notificationEmail
    ) {
      return;
    }

    this.logger.log(
      `Sending grading completion email for attempt ${attemptId} to ${gradingProgress.notificationEmail}`,
    );

    try {
      const grade = gradingProgress.attempt.grade
        ? gradingProgress.attempt.grade * 100
        : undefined;

      await this.emailService.sendGradingCompletionEmail(
        gradingProgress.notificationEmail,
        gradingProgress.attempt.assignmentId,
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

  /**
   * Get grading progress for an attempt
   */
  async getProgress(attemptId: number) {
    return this.prisma.gradingProgress.findUnique({
      where: { attemptId },
    });
  }

  /**
   * Enable email notification for grading completion.
   *
   * The frontend can call /notify before the worker has run initializeProgress
   * (which is the only path that creates a GradingProgress row). Upsert so the
   * row is created with the notification settings if absent; initializeProgress
   * will later overwrite totalQuestions/status without touching the
   * notifyOnComplete / notificationEmail fields.
   */
  async enableEmailNotification(
    attemptId: number,
    email: string,
  ): Promise<void> {
    try {
      await this.prisma.gradingProgress.upsert({
        where: { attemptId },
        create: {
          attemptId,
          totalQuestions: 0,
          notifyOnComplete: true,
          notificationEmail: email,
        },
        update: {
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

  private snapshot(attemptId: number): GradingProgressDetails | undefined {
    const map = this.perQuestionState.get(attemptId);
    if (!map) return undefined;

    const questions = [...map.values()].sort(
      (a, b) => a.displayOrder - b.displayOrder,
    );
    let completed = 0;
    let inFlight = 0;
    let failed = 0;
    let hasSlowInFlight = false;
    for (const q of questions) {
      switch (q.status) {
        case "completed": {
          completed += 1;
          break;
        }
        case "in_progress": {
          inFlight += 1;
          if (q.slowType) hasSlowInFlight = true;
          break;
        }
        case "failed": {
          failed += 1;
          break;
        }
        default: {
          break;
        }
      }
    }
    return {
      questions,
      total: questions.length,
      completed,
      inFlight,
      failed,
      hasSlowInFlight,
    };
  }

  private computePercentage(details: GradingProgressDetails): number {
    if (details.total === 0) return 0;
    // Reserve last 10% for finalize/commit phases that run after grading.
    const fraction = details.completed / details.total;
    return Math.min(90, Math.round(fraction * 90));
  }

  private buildStageMessage(details: GradingProgressDetails): string {
    if (details.total === 0) return "Grading...";
    if (details.completed === details.total) return "Grading complete!";
    return `Grading ${details.completed} of ${details.total} questions complete${
      details.inFlight > 0 ? ` — ${details.inFlight} in progress` : ""
    }`;
  }

  private async emit(
    attemptId: number,
    status: string,
    progress: string,
    percentage?: number,
    currentQuestion?: number,
    totalQuestions?: number,
  ): Promise<void> {
    const callback = this.progressCallbacks.get(attemptId);
    if (!callback) return;
    const details = this.snapshot(attemptId);
    try {
      await callback(
        status,
        progress,
        percentage,
        details,
        currentQuestion,
        totalQuestions,
      );
    } catch (error) {
      this.logger.warn(
        `progress.callback.threw attempt=${attemptId} error=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
