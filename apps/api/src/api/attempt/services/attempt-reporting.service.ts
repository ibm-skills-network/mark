import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { PrismaService } from "../../../prisma.service";
import { ReportType } from "@prisma/client";

@Injectable()
export class AttemptReportingService {
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
    // Ensure the assignment exists
    const assignmentExists = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
    });

    if (!assignmentExists) {
      throw new NotFoundException("Assignment not found");
    }

    // Ensure the assignment attempt exists
    const assignmentAttemptExists =
      await this.prisma.assignmentAttempt.findUnique({
        where: { id: attemptId },
      });

    if (!assignmentAttemptExists) {
      throw new NotFoundException("Assignment attempt not found");
    }

    // Check rate limiting - if the user has created too many reports
    const reports = await this.prisma.report.findMany({
      where: {
        reporterId: userId,
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
        },
      },
    });

    // Limit to 5 reports per 24 hours
    if (reports.length >= 5) {
      throw new UnprocessableEntityException(
        "You have reached the maximum number of reports allowed in a 24-hour period.",
      );
    }

    // Create the report
    await this.prisma.report.create({
      data: {
        assignmentId,
        attemptId,
        issueType,
        description,
        reporterId: userId,
        author: false, // Mark as not from an author
      },
    });
  }
}
