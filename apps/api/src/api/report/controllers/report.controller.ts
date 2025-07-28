import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Req,
  Patch,
  BadRequestException,
  Injectable,
  UseGuards,
} from "@nestjs/common";
import { ReportStatus } from "@prisma/client";
import { ReportsService } from "../services/report.service";
import {
  UserRole,
  UserSessionRequest,
} from "src/auth/interfaces/user.session.interface";
import { Roles } from "src/auth/role/roles.global.guard";
import { ApiTags } from "@nestjs/swagger";
import { AssignmentAccessControlGuard } from "src/api/assignment/guards/assignment.access.control.guard";

@ApiTags("Reports")
@Injectable()
@Controller({
  path: "reports",
  version: "1",
})
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}
  @Post()
  async reportIssue(
    @Body()
    dto: {
      issueType: string;
      description: string;
      assignmentId?: number;
      attemptId?: number;
      severity?: "info" | "warning" | "error" | "critical";
      category?: string;
      portalName?: string;
      userEmail?: string;
      userRole?: string;
      additionalDetails?: Record<string, any>;
    },
    @Req() request: UserSessionRequest,
  ): Promise<{ message: string; issueNumber?: number; reportId?: number }> {
    const reportDto = {
      issueType: dto.issueType,
      description: dto.description,
      assignmentId: dto.assignmentId,
      attemptId: dto.attemptId,
      severity: dto.severity,
      additionalDetails: {
        ...dto.additionalDetails,
        category: dto.category,
        portalName: dto.portalName,
        userEmail: dto.userEmail,
      },
    };

    return this.reportsService.reportIssue(reportDto, request.userSession);
  }

  @Get("assignment/:id")
  @UseGuards(AssignmentAccessControlGuard)
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  async getReportsForAssignment(@Param("id") id: string) {
    return this.reportsService.getReportsForAssignment(Number(id));
  }

  @Get("user")
  @UseGuards(AssignmentAccessControlGuard)
  async getReportsForUser(@Req() request: UserSessionRequest) {
    const userId = request.userSession?.userId;
    if (!userId) {
      throw new BadRequestException("User ID is required");
    }
    return this.reportsService.getReportsForUser(userId);
  }

  @Get(":id")
  @UseGuards(AssignmentAccessControlGuard)
  async getReportById(
    @Param("id") id: string,
    @Req() request: UserSessionRequest,
  ) {
    const userId = request.userSession?.userId;
    if (!userId) {
      throw new BadRequestException("User ID is required");
    }
    return this.reportsService.getReportDetailsForUser(Number(id), userId);
  }

  @Patch(":id/status")
  @UseGuards(AssignmentAccessControlGuard)
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  async updateReportStatus(
    @Param("id") id: string,
    @Body()
    updateData: {
      status: ReportStatus;
      statusMessage?: string;
      resolution?: string;
    },
  ) {
    return this.reportsService.updateReportStatus(
      Number(id),
      updateData.status,
      updateData.statusMessage,
      updateData.resolution,
    );
  }

  @Post("feedback")
  @UseGuards(AssignmentAccessControlGuard)
  async sendUserFeedback(
    @Body()
    feedbackDto: {
      title: string;
      description: string;
      rating: string;
      assignmentId?: number;
      userEmail?: string;
      portalName?: string;
    },
    @Req() request: UserSessionRequest,
  ) {
    return this.reportsService.sendUserFeedback(
      feedbackDto.title,
      feedbackDto.description,
      feedbackDto.rating,
      feedbackDto.userEmail || request.userSession?.userId,
      feedbackDto.portalName || "Mark AI Assistant",
      request.userSession?.userId,
      feedbackDto.assignmentId || request.userSession?.assignmentId,
    );
  }
}
