/* eslint-disable @typescript-eslint/require-await */
import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Injectable,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { ReportStatus } from "@prisma/client";
import { memoryStorage } from "multer";
import { AssignmentAccessControlGuard } from "src/api/assignment/guards/assignment.access.control.guard";
import { AdminGuard } from "src/auth/guards/admin.guard";
import {
  UserRole,
  UserSessionRequest,
} from "src/auth/interfaces/user.session.interface";
import { Roles } from "src/auth/role/roles.global.guard";
import { ReportsService } from "../services/report.service";

@ApiTags("Reports")
@Injectable()
@Controller({
  path: "reports",
  version: "1",
})
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}
  @Get("feedback")
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: "Get all assignment feedback with pagination and filtering",
  })
  @ApiQuery({ name: "page", required: false, type: Number, example: 1 })
  @ApiQuery({ name: "limit", required: false, type: Number, example: 20 })
  @ApiQuery({ name: "search", required: false, type: String })
  @ApiQuery({ name: "assignmentId", required: false, type: Number })
  @ApiQuery({ name: "allowContact", required: false, type: Boolean })
  @ApiQuery({ name: "startDate", required: false, type: String })
  @ApiQuery({ name: "endDate", required: false, type: String })
  async getFeedback(
    @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query("limit", new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query("search") search?: string,
    @Query("allowContact") allowContact?: string,
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
    @Req() request?: UserSessionRequest,
  ) {
    // Convert admin session to user session format for the service
    const userSession = request?.userSession
      ? {
          userId: request.userSession.userId,
          role: request.userSession.role,
          assignmentId: undefined,
          groupId: undefined,
        }
      : request?.userSession;

    return this.reportsService.getFeedback({
      page,
      limit,
      search,
      assignmentId: undefined,
      allowContact:
        allowContact === "true"
          ? true
          : allowContact === "false"
            ? false
            : undefined,
      startDate,
      endDate,
      userSession,
    });
  }

  @Get()
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Get all reports with pagination and filtering" })
  @ApiQuery({ name: "page", required: false, type: Number, example: 1 })
  @ApiQuery({ name: "limit", required: false, type: Number, example: 20 })
  @ApiQuery({ name: "search", required: false, type: String })
  @ApiQuery({ name: "assignmentId", required: false, type: Number })
  @ApiQuery({ name: "status", required: false, type: String })
  @ApiQuery({ name: "issueType", required: false, type: String })
  @ApiQuery({ name: "startDate", required: false, type: String })
  @ApiQuery({ name: "endDate", required: false, type: String })
  async getReports(
    @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query("limit", new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query("search") search?: string,
    @Query("status") status?: string,
    @Query("issueType") issueType?: string,
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
  ) {
    return this.reportsService.getReports({
      page,
      limit,
      search,
      assignmentId: undefined,
      status: status,
      issueType: issueType,
      startDate,
      endDate,
    });
  }
  @Post()
  @UseInterceptors(
    FileInterceptor("screenshot", {
      storage: memoryStorage(),
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
      },
    }),
  )
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
    @UploadedFile() screenshot: Express.Multer.File,
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
    console.log("Reporting issue:", reportDto);
    return this.reportsService.reportIssue(
      reportDto,
      request.userSession,
      screenshot,
    );
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

  @Patch(":id/screenshot")
  @UseGuards(AssignmentAccessControlGuard)
  async addScreenshotToReport(
    @Param("id") id: string,
    @Body()
    screenshotData: {
      screenshotUrl: string;
      bucket?: string;
    },
    @Req() request: UserSessionRequest,
  ) {
    const userId = request.userSession?.userId;
    if (!userId) {
      throw new BadRequestException("User ID is required");
    }
    return this.reportsService.addScreenshotToReport(
      Number(id),
      screenshotData.screenshotUrl,
      userId,
      screenshotData.bucket,
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
