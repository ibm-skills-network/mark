import {
  HttpException,
  HttpStatus,
  Injectable,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  ATTEMPT_IN_PROGRESS_CODE,
  ATTEMPT_MAX_REACHED_CODE,
  ATTEMPT_TIME_RANGE_EXCEEDED_CODE,
  IN_COOLDOWN_PERIOD,
  IN_PROGRESS_SUBMISSION_EXCEPTION,
  MAX_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
  SUBMISSION_DEADLINE_EXCEPTION_MESSAGE,
  TIME_RANGE_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
} from "src/api/assignment/attempt/api-exceptions/exceptions";
import {
  GetAssignmentResponseDto,
  LearnerGetAssignmentResponseDto,
} from "src/api/assignment/dto/get.assignment.response.dto";
import { UserSession } from "../../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../../database/prisma.service";
import { GradingKillSwitchService } from "../../ai-feature-flags/grading-kill-switch.service";

/**
 * Where-clause matching this learner+assignment's active (unsubmitted,
 * unexpired) attempt. Shared between the validation "attempt in progress"
 * check and AttemptSubmissionService.findResumableAttempt so the two
 * definitions of "active" cannot drift — the idempotent-resume path relies on
 * resuming at least every attempt that validation would reject as in-progress.
 */
export function activeAttemptWhere(
  assignmentId: number,
  userId: string,
  now: Date,
): Prisma.AssignmentAttemptWhereInput {
  return {
    assignmentId,
    userId,
    submitted: false,
    OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
  };
}

@Injectable()
export class AttemptValidationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gradingKillSwitch: GradingKillSwitchService,
  ) {}

  /**
   * Validates whether a new attempt can be created for the given assignment and user session.
   * @param assignment The assignment object.
   * @param userSession The user session.
   * @param database Pass the transaction client when calling inside an open
   * interactive transaction: the caller already holds that transaction's pool
   * connection, and issuing these queries through `this.prisma` instead would
   * demand a second connection per in-flight creation — enough concurrent
   * creators then exhaust the pool and every attempt-start times out.
   */
  async validateNewAttempt(
    assignment: GetAssignmentResponseDto | LearnerGetAssignmentResponseDto,
    userSession: UserSession,
    database: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    // Kill-switch: block starting an attempt on an AI-graded assignment while
    // grading is disabled. Non-AI assignments (e.g. MCQ-only) are unaffected.
    await this.gradingKillSwitch.assertGradingAllowed(
      assignment.id,
      userSession.userId,
      "start",
      database,
    );

    const now = new Date();
    const timeRangeStartDate = this.calculateTimeRangeStartDate(assignment);

    const activeAttempt = await database.assignmentAttempt.findFirst({
      where: activeAttemptWhere(assignment.id, userSession.userId, now),
      orderBy: { createdAt: "desc" },
    });

    if (activeAttempt) {
      throw new UnprocessableEntityException({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        code: ATTEMPT_IN_PROGRESS_CODE,
        message: IN_PROGRESS_SUBMISSION_EXCEPTION,
      });
    }

    if (assignment.attemptsPerTimeRange) {
      const attemptsInTimeRange = await database.assignmentAttempt.count({
        where: {
          userId: userSession.userId,
          assignmentId: assignment.id,
          createdAt: {
            gte: timeRangeStartDate,
            lte: now,
          },
        },
      });

      if (attemptsInTimeRange >= assignment.attemptsPerTimeRange) {
        throw new UnprocessableEntityException({
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          code: ATTEMPT_TIME_RANGE_EXCEEDED_CODE,
          message: TIME_RANGE_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
        });
      }
    }

    if (assignment.numAttempts !== null && assignment.numAttempts !== -1) {
      const totalAttempts = await this.countUserAttempts(
        userSession.userId,
        assignment.id,
        database,
      );

      if (totalAttempts >= assignment.numAttempts) {
        throw new UnprocessableEntityException({
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          code: ATTEMPT_MAX_REACHED_CODE,
          message: MAX_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
        });
      }

      const attemptsBeforeCoolDown = assignment.attemptsBeforeCoolDown ?? 1;
      const cooldownMinutes = assignment.retakeAttemptCoolDownMinutes ?? 0;

      if (
        attemptsBeforeCoolDown > 0 &&
        cooldownMinutes > 0 &&
        totalAttempts >= attemptsBeforeCoolDown
      ) {
        const lastSubmittedAttempt = await database.assignmentAttempt.findFirst(
          {
            where: {
              userId: userSession.userId,
              assignmentId: assignment.id,
              submitted: true,
            },
            orderBy: [{ expiresAt: "desc" }, { createdAt: "desc" }],
          },
        );

        if (lastSubmittedAttempt) {
          const lastAttemptReference =
            lastSubmittedAttempt.expiresAt ?? lastSubmittedAttempt.createdAt;

          if (lastAttemptReference) {
            const referenceTimestamp = new Date(lastAttemptReference).getTime();

            if (!Number.isNaN(referenceTimestamp)) {
              const lastAttemptTime = Math.min(
                referenceTimestamp,
                now.getTime(),
              );
              const cooldownMs = cooldownMinutes * 60_000;
              const nextEligibleTime = lastAttemptTime + cooldownMs;

              if (now.getTime() < nextEligibleTime) {
                throw new HttpException(
                  {
                    statusCode: HttpStatus.TOO_MANY_REQUESTS,
                    message: IN_COOLDOWN_PERIOD,
                  },
                  HttpStatus.TOO_MANY_REQUESTS,
                );
              }
            }
          }
        }
      }
    }
  }

  /**
   * Checks if an attempt is expired
   * @param expiresAt The expiration date of the attempt
   * @returns True if the attempt is expired
   */
  isAttemptExpired(expiresAt: Date | null): boolean {
    if (!expiresAt) return false;
    const tenSecondsBeforeNow = new Date(Date.now() - 10 * 1000);
    return tenSecondsBeforeNow > expiresAt;
  }

  /**
   * Checks if the submission deadline has passed
   * @param expiresAt The expiration date of the assignment attempt
   */
  checkSubmissionDeadline(expiresAt: Date | null | undefined): void {
    const thirtySecondsBeforeNow = new Date(Date.now() - 30 * 1000);
    if (expiresAt && thirtySecondsBeforeNow > expiresAt) {
      throw new UnprocessableEntityException(
        SUBMISSION_DEADLINE_EXCEPTION_MESSAGE,
      );
    }
  }

  /**
   * Calculates the time range start date based on the assignment settings
   * @param assignment The assignment object
   * @returns The time range start date
   */
  private calculateTimeRangeStartDate(
    assignment: GetAssignmentResponseDto | LearnerGetAssignmentResponseDto,
  ): Date {
    if (assignment.attemptsTimeRangeHours) {
      return new Date(
        Date.now() - assignment.attemptsTimeRangeHours * 60 * 60 * 1000,
      );
    }
    return new Date();
  }

  /**
   * Counts the number of attempts made by a user for a specific assignment
   * @param userId The user ID
   * @param assignmentId The assignment ID
   * @returns The number of attempts
   */
  private async countUserAttempts(
    userId: string,
    assignmentId: number,
    database: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<number> {
    return database.assignmentAttempt.count({
      where: {
        userId: userId,
        assignmentId: assignmentId,
      },
    });
  }
}
