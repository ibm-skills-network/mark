import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import { PrismaService } from "../../../prisma.service";
import { UserSession } from "../../../auth/interfaces/user.session.interface";
import {
  IN_PROGRESS_SUBMISSION_EXCEPTION,
  TIME_RANGE_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
  MAX_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
  SUBMISSION_DEADLINE_EXCEPTION_MESSAGE,
} from "src/api/assignment/attempt/api-exceptions/exceptions";
import {
  GetAssignmentResponseDto,
  LearnerGetAssignmentResponseDto,
} from "src/api/assignment/dto/get.assignment.response.dto";

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
    const timeRangeStartDate = this.calculateTimeRangeStartDate(assignment);

    const attempts = await this.prisma.assignmentAttempt.findMany({
      where: {
        userId: userSession.userId,
        assignmentId: assignment.id,
        OR: [
          {
            submitted: false,
            expiresAt: {
              gte: new Date(),
            },
          },
          {
            submitted: false,
            expiresAt: undefined,
          },
          {
            createdAt: {
              gte: timeRangeStartDate,
              lte: new Date(),
            },
          },
        ],
      },
    });

    // Check for ongoing attempts
    const ongoingAttempts = attempts.filter(
      (sub) =>
        !sub.submitted &&
        (sub.expiresAt >= new Date() || sub.expiresAt === null),
    );

    if (ongoingAttempts.length > 0) {
      throw new UnprocessableEntityException(IN_PROGRESS_SUBMISSION_EXCEPTION);
    }

    // Check attempts per time range
    const attemptsInTimeRange = attempts.filter(
      (sub) =>
        sub.createdAt >= timeRangeStartDate && sub.createdAt <= new Date(),
    );

    if (
      assignment.attemptsPerTimeRange &&
      attemptsInTimeRange.length >= assignment.attemptsPerTimeRange
    ) {
      throw new UnprocessableEntityException(
        TIME_RANGE_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
      );
    }

    // Check maximum attempts
    if (assignment.numAttempts !== null && assignment.numAttempts !== -1) {
      const attemptCount = await this.countUserAttempts(
        userSession.userId,
        assignment.id,
      );

      if (attemptCount >= assignment.numAttempts) {
        throw new UnprocessableEntityException(
          MAX_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
        );
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
