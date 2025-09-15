import {
  Controller,
  DefaultValuePipe,
  Get,
  Injectable,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { AdminGuard } from "src/auth/guards/admin.guard";
import {
  UserRole,
  UserSessionRequest,
} from "src/auth/interfaces/user.session.interface";
import { Roles } from "src/auth/role/roles.global.guard";
import { ScheduledTasksService } from "../../scheduled-tasks/services/scheduled-tasks.service";
import { AdminService } from "../admin.service";

interface AdminSessionRequest extends Request {
  adminSession: {
    email: string;
    role: UserRole;
    sessionToken: string;
  };
}

interface AssignmentAnalyticsResponse {
  data: Array<{
    id: number;
    name: string;
    totalCost: number;
    uniqueLearners: number;
    totalAttempts: number;
    completedAttempts: number;
    averageGrade: number;
    averageRating: number;
    published: boolean;
    insights: {
      questionInsights: Array<{
        questionId: number;
        questionText: string;
        correctPercentage: number;
        firstAttemptSuccessRate: number;
        avgPointsEarned: number;
        maxPoints: number;
        insight: string;
      }>;
      performanceInsights: string[];
      costBreakdown: {
        grading: number;
        questionGeneration: number;
        translation: number;
        other: number;
      };
      detailedCostBreakdown?: Array<{
        tokensIn: number;
        tokensOut: number;
        inputCost: number;
        outputCost: number;
        totalCost: number;
        usageDate: string;
        modelKey: string;
        inputTokenPrice: number;
        outputTokenPrice: number;
        pricingEffectiveDate: string;
        usageType?: string;
        calculationSteps: {
          inputCalculation: string;
          outputCalculation: string;
          totalCalculation: string;
        };
      }>;
    };
  }>;
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
@ApiTags("Admin Dashboard")
@UseGuards(AdminGuard)
@ApiBearerAuth()
@Injectable()
@Controller({
  path: "admin-dashboard",
  version: "1",
})
export class AdminDashboardController {
  constructor(
    private adminService: AdminService,
    private scheduledTasksService: ScheduledTasksService,
  ) {}

  @Get("stats")
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @ApiOperation({
    summary: "Get admin dashboard statistics",
  })
  @ApiQuery({ name: "startDate", required: false, type: String })
  @ApiQuery({ name: "endDate", required: false, type: String })
  @ApiQuery({ name: "assignmentId", required: false, type: Number })
  @ApiQuery({ name: "assignmentName", required: false, type: String })
  @ApiQuery({ name: "userId", required: false, type: String })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403 })
  async getDashboardStats(
    @Req() request: UserSessionRequest,
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
    @Query("assignmentId") assignmentId?: string,
    @Query("assignmentName") assignmentName?: string,
    @Query("userId") userId?: string,
  ): Promise<any> {
    return this.adminService.getDashboardStats(request.userSession, {
      startDate,
      endDate,
      assignmentId: assignmentId
        ? Number.parseInt(assignmentId, 10)
        : undefined,
      assignmentName,
      userId,
    });
  }
  @Get("quick-actions/:action")
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @ApiOperation({
    summary: "Execute predefined quick actions for dashboard insights",
  })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403 })
  async executeQuickAction(
    @Req() request: AdminSessionRequest,
    @Param("action") action: string,
    @Query("limit", new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ): Promise<any> {
    return this.adminService.executeQuickAction(
      request.adminSession,
      action,
      limit,
    );
  }

  /**
   * Get assignment analytics with detailed insights
   */
  @Get("analytics")
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary:
      "Get detailed assignment analytics with insights (for authors and admins)",
  })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiQuery({ name: "search", required: false, type: String })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403 })
  async getAssignmentAnalytics(
    @Req() request: UserSessionRequest,
    @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query("limit", new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query("search") search?: string,
  ): Promise<AssignmentAnalyticsResponse> {
    return await this.adminService.getAssignmentAnalytics(
      request.userSession,
      page,
      limit,
      search,
    );
  }

  /**
   * Get detailed insights for a specific assignment
   */
  @Get("assignments/:id/insights")
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: "Get detailed insights for a specific assignment",
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 404 })
  async getDetailedAssignmentInsights(
    @Req() request: UserSessionRequest,
    @Param("id", ParseIntPipe) id: number,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return await this.adminService.getDetailedAssignmentInsights(
      request.userSession,
      id,
    );
  }

  /**
   * Manual cleanup of old drafts
   */
  @Post("cleanup/drafts")
  @Roles(UserRole.ADMIN)
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: "Manually trigger cleanup of old drafts (Admin only)",
    description:
      "Deletes drafts older than the specified number of days (default: 60 days)",
  })
  @ApiQuery({
    name: "daysOld",
    required: false,
    type: Number,
    description:
      "Number of days old drafts should be to get deleted (default: 60). Use 0 to delete ALL drafts.",
  })
  @ApiResponse({
    status: 200,
    description: "Cleanup completed successfully",
    schema: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        message: { type: "string" },
        deletedCount: { type: "number" },
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: "Forbidden - Admin access required",
  })
  async manualDraftCleanup(
    @Req() request: AdminSessionRequest,
    @Query("daysOld", new DefaultValuePipe(60), ParseIntPipe) daysOld: number,
  ) {
    try {
      const result =
        await this.scheduledTasksService.manualCleanupOldDrafts(daysOld);
      const message =
        daysOld === 0
          ? "All drafts have been deleted"
          : `Draft cleanup completed for drafts older than ${daysOld} days`;

      return {
        success: true,
        message,
        ...result,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Draft cleanup failed: ${errorMessage}`,
      };
    }
  }
}
