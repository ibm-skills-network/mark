import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { GradingStatus, LtiSyncStatus } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";
import { LtiGradeSyncService } from "../../attempt/services/lti-grade-sync.service";

export interface ForcePassResult {
  success: true;
  attemptId: number;
  grade: number;
  submitted: boolean;
  lti: {
    attempted: boolean;
    status: LtiSyncStatus | null;
    message: string;
  };
}

/**
 * Admin-only operations that act directly on a single learner attempt.
 * Kept separate from the large AdminService so the force-pass write path has a
 * narrow, well-tested surface and its own dependency on the LTI sync service.
 */
@Injectable()
export class AttemptAdminService {
  private readonly logger = new Logger(AttemptAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ltiGradeSyncService: LtiGradeSyncService,
  ) {}

  /**
   * Force an attempt to a passing (or explicit) grade and mark it submitted.
   *
   * This is the manual override for the case where grading never completed or
   * produced the wrong outcome and the learner should be passed by hand. It:
   *  1. sets the attempt grade (0-1 fraction) and submitted=true in Mark's DB,
   *     and forces the attempt's GradingProgress to COMPLETED in the same
   *     transaction so the learner-facing progress UI doesn't keep reporting a
   *     stale PROCESSING/FAILED state for an attempt that has now been passed,
   *  2. best-effort re-syncs the grade to the LMS by reusing the most recent
   *     auth cookie captured for this attempt — if none exists (e.g. the attempt
   *     never reached a sync), the LMS is left untouched and the caller is told.
   *
   * @param attemptId   Attempt to override.
   * @param gradePercent 0-100 grade to set (defaults to 100 = pass).
   * @param adminEmail  Acting admin, for the audit log.
   */
  async forcePass(
    attemptId: number,
    gradePercent: number,
    adminEmail: string,
  ): Promise<ForcePassResult> {
    const attempt = await this.prisma.assignmentAttempt.findUnique({
      where: { id: attemptId },
    });

    if (!attempt) {
      throw new NotFoundException(`Attempt ${attemptId} not found`);
    }

    const grade = gradePercent / 100;

    // Set the grade and force the grading-progress row to COMPLETED atomically.
    // The two are a single logical state: a force-pass that left GradingProgress
    // at PROCESSING/FAILED would show the learner a "still grading"/"grading
    // failed" UI for an attempt that has actually been passed. upsert (not
    // update) because the attempt may never have started grading and so may have
    // no progress row yet; totalQuestions is required on create and matches the
    // attempt's question count.
    const totalQuestions = attempt.questionOrder?.length ?? 0;
    await this.prisma.$transaction([
      this.prisma.assignmentAttempt.update({
        where: { id: attemptId },
        // expiresAt closes the attempt window, matching every other
        // finalization path (commit/auto-grade-on-expiry). Without it a
        // force-passed in-progress timed attempt keeps a future expiresAt,
        // which the retake-cooldown check keys off and would over-block the
        // learner from starting a new attempt.
        data: { grade, submitted: true, expiresAt: new Date() },
      }),
      this.prisma.gradingProgress.upsert({
        where: { attemptId },
        create: {
          attemptId,
          totalQuestions,
          status: GradingStatus.COMPLETED,
          progress: 100,
          currentStage: "Grading complete!",
          completedAt: new Date(),
        },
        update: {
          status: GradingStatus.COMPLETED,
          progress: 100,
          currentStage: "Grading complete!",
          error: null,
          completedAt: new Date(),
        },
      }),
    ]);

    const lti = await this.resyncGrade(attempt.userId, {
      attemptId,
      assignmentId: attempt.assignmentId,
      grade,
    });

    // Audit: who, which attempt, resulting grade, and what happened with the
    // LMS sync. No learner PII beyond the userId already on the attempt.
    this.logger.log(
      `force-pass: admin=${adminEmail} attempt=${attemptId} ` +
        `grade=${grade} lti=${lti.attempted ? lti.status : "skipped"}`,
    );

    return { success: true, attemptId, grade, submitted: true, lti };
  }

  /**
   * Best-effort grade push to the LTI gateway, reusing the auth cookie from the
   * attempt's most recent sync record. A force-pass must still succeed in Mark
   * even when the LMS cannot be reached, so every failure here is reported, not
   * thrown.
   */
  private async resyncGrade(
    userId: string,
    request: { attemptId: number; assignmentId: number; grade: number },
  ): Promise<ForcePassResult["lti"]> {
    const lastSync = await this.prisma.ltiGradeSync.findFirst({
      where: { attemptId: request.attemptId, authCookie: { not: "" } },
      orderBy: { createdAt: "desc" },
    });

    if (!lastSync?.authCookie) {
      return {
        attempted: false,
        status: null,
        message:
          "No prior LTI sync for this attempt; grade saved in Mark but not pushed to the LMS.",
      };
    }

    // The LMS gradebook holds the learner's HIGHEST grade across all their
    // attempts for this assignment (see attempt-submission.service's normal
    // sync path). Pushing this attempt's grade raw could regress a
    // previously-synced better attempt, so push the max instead. The
    // force-pass grade is already persisted on the attempt before this runs,
    // so the query includes it; request.grade is folded in explicitly to stay
    // correct under read-replica lag.
    const userAttempts = await this.prisma.assignmentAttempt.findMany({
      where: { userId, assignmentId: request.assignmentId },
      select: { grade: true },
    });
    let highestOverall = 0;
    for (const userAttempt of userAttempts) {
      if (userAttempt.grade && userAttempt.grade > highestOverall) {
        highestOverall = userAttempt.grade;
      }
    }
    if (request.grade > highestOverall) {
      highestOverall = request.grade;
    }

    try {
      const result = await this.ltiGradeSyncService.createAndSync({
        attemptId: request.attemptId,
        userId,
        assignmentId: request.assignmentId,
        grade: highestOverall,
        authCookie: lastSync.authCookie,
      });
      return {
        attempted: true,
        status: result.status,
        message: result.message,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      this.logger.warn(
        `force-pass LTI resync failed for attempt ${request.attemptId}: ${message}`,
      );
      return {
        attempted: true,
        status: LtiSyncStatus.FAILED,
        message: `LTI resync failed: ${message}`,
      };
    }
  }
}
