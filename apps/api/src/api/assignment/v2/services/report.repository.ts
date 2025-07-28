import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ReportType } from "@prisma/client";
import { PrismaService } from "src/prisma.service";

@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createReport(
    assignmentId: number,
    issueType: ReportType,
    description: string,
    userId: string,
  ): Promise<void> {
    this.validateReportInputs(issueType, description, userId);

    const assignmentExists = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
    });

    if (!assignmentExists) {
      throw new NotFoundException("Assignment not found");
    }

    await this.checkRateLimit(userId);

    await this.prisma.report.create({
      data: {
        assignmentId,
        issueType,
        description,
        reporterId: userId,
        author: true,
      },
    });
  }

  private validateReportInputs(
    issueType: ReportType,
    description: string,
    userId: string,
  ): void {
    if (!issueType || !description) {
      throw new BadRequestException("Issue type and description are required");
    }

    const validIssueTypes = Object.values(ReportType);
    if (!validIssueTypes.includes(issueType)) {
      throw new BadRequestException("Invalid issue type");
    }

    if (!userId || userId.trim() === "") {
      throw new BadRequestException("Invalid user ID");
    }
  }

  private async checkRateLimit(userId: string): Promise<void> {
    const recentReports = await this.prisma.report.findMany({
      where: {
        reporterId: userId,
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
    });

    if (recentReports.length >= 5) {
      throw new UnprocessableEntityException(
        "You have reached the maximum number of reports allowed in a 24-hour period.",
      );
    }
  }
}
