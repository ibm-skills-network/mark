import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ReportType } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";

@Injectable()
export class AttemptReportingService {
  private readonly logger = new Logger(AttemptReportingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a report for an assignment attempt
   * @param assignmentId Assignment ID
   * @param attemptId Attempt ID
   * @param issueType Report issue type
   * @param description Report description
   * @param userId User ID of the reporter
   */
  async createReport(
    assignmentId: number,
    attemptId: number,
    issueType: ReportType,
    description: string,
    userId: string,
  ): Promise<void> {
    const assignmentExists = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
    });

    if (!assignmentExists) {
      throw new NotFoundException("Assignment not found");
    }

    // The route's ids come from the client: the attempt must be the
    // reporter's own and belong to this assignment. Every refusal looks the
    // same, so the endpoint cannot be used to probe for other attempts.
    const attempt =
      Number.isSafeInteger(attemptId) && attemptId > 0
        ? await this.prisma.assignmentAttempt.findUnique({
            where: { id: attemptId },
            select: { userId: true, assignmentId: true },
          })
        : null;
    if (
      !attempt ||
      attempt.userId !== userId ||
      attempt.assignmentId !== assignmentId
    ) {
      this.logger.warn("createReport: attempt not reportable by this user", {
        user_id: userId,
        assignment_id: assignmentId,
        attempt_id: attemptId,
        reason: attempt
          ? attempt.userId === userId
            ? "assignment_mismatch"
            : "not_owner"
          : "not_found",
      });
      throw new NotFoundException("Assignment attempt not found");
    }

    const reports = await this.prisma.report.findMany({
      where: {
        reporterId: userId,
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
    });

    if (reports.length >= 5) {
      throw new UnprocessableEntityException(
        "You have reached the maximum number of reports allowed in a 24-hour period.",
      );
    }

    await this.prisma.report.create({
      data: {
        assignmentId,
        attemptId,
        issueType,
        description,
        reporterId: userId,
        author: false,
      },
    });
  }
}
