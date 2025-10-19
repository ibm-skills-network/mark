import {
  HttpException,
  HttpStatus,
  Injectable,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
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

@Injectable()
export class AttemptValidationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validates whether a new attempt can be created for the given assignment and user session.
   * @param assignment The assignment object.
   * @param userSession The user session.
   */
  async validateNewAttempt(
    assignment: GetAssignmentResponseDto | LearnerGetAssignmentResponseDto,
    userSession: UserSession,
  ): Promise<void> {
    const now = new Date();
    const timeRangeStartDate = this.calculateTimeRangeStartDate(assignment);

    const attempts = await this.prisma.assignmentAttempt.findMany({
      where: {
        userId: userSession.userId,
        assignmentId: assignment.id,
        OR: [
          {
            submitted: false,
            expiresAt: {
              gte: now,
            },
          },
          {
            submitted: false,
            expiresAt: undefined,
          },
          {
            createdAt: {
              gte: timeRangeStartDate,
              lte: now,
            },
          },
        ],
      },
      orderBy: { createdAt: "desc" },
    });

    const lastSubmittedAttempt = await this.prisma.assignmentAttempt.findFirst({
      where: {
        userId: userSession.userId,
        assignmentId: assignment.id,
        submitted: true,
      },
      orderBy: { expiresAt: "desc" },
    });

    const ongoingAttempts = attempts.filter(
      (sub) => !sub.submitted && (!sub.expiresAt || sub.expiresAt >= now),
    );

    if (ongoingAttempts.length > 0) {
      throw new UnprocessableEntityException(IN_PROGRESS_SUBMISSION_EXCEPTION);
    }

    const attemptsInTimeRange = attempts.filter(
      (sub) => sub.createdAt >= timeRangeStartDate && sub.createdAt <= now,
    );

    if (
      assignment.attemptsPerTimeRange &&
      attemptsInTimeRange.length >= assignment.attemptsPerTimeRange
    ) {
      throw new UnprocessableEntityException(
        TIME_RANGE_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
      );
    }

    if (assignment.numAttempts !== null && assignment.numAttempts !== -1) {
      const totalAttempts = await this.countUserAttempts(
        userSession.userId,
        assignment.id,
      );

      if (totalAttempts >= assignment.numAttempts) {
        throw new UnprocessableEntityException(
          MAX_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
        );
      }

      const attemptsBeforeCoolDown = assignment.attemptsBeforeCoolDown ?? 1;
      const cooldownMinutes = assignment.retakeAttemptCoolDownMinutes ?? 0;

      if (
        attemptsBeforeCoolDown > 0 &&
        totalAttempts >= attemptsBeforeCoolDown
      ) {
        const lastAttemptTime = new Date(
          lastSubmittedAttempt.expiresAt,
        ).getTime();
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
  ): Promise<number> {
    return this.prisma.assignmentAttempt.count({
      where: {
        userId: userId,
        assignmentId: assignmentId,
      },
    });
  }
}
