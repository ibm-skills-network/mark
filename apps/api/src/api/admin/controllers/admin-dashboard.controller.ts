import {
  BadRequestException,
  Controller,
  DefaultValuePipe,
  Get,
  Injectable,
  Param,
  ParseBoolPipe,
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
import { ScheduledTasksService } from "../../scheduled-tasks/services/scheduled-tasks.service";
import { AdminService } from "../admin.service";
import { DashboardStatsQueryDto } from "./dto/dashboard-stats-query.dto";

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
  aggregates: {
    totalAssignments: number;
    totalCost: number;
    totalLearnerAssignmentPairs: number;
    averageRating: number;
  };
}

// Input validation constants
const MAX_LIMIT = 25;
const DEFAULT_LIMIT = 10;
const MAX_DATE_WINDOW_DAYS = 365;
const ANALYTICS_SORT_FIELDS = ["name", "updatedAt", "published"] as const;
type AnalyticsSortField = (typeof ANALYTICS_SORT_FIELDS)[number];

@ApiTags("Admin Dashboard")
// AdminGuard covers the whole controller and is the single source of truth for
// access here. Deliberately no @Roles on any handler: RolesGlobalGuard is a
// global guard, so it runs BEFORE AdminGuard and would decide on the forwarded
// cookie session — an admin browsing with a learner/author launch cookie would
// be rejected before AdminGuard could establish the admin role. AdminGuard is
// strictly narrower than @Roles(AUTHOR, ADMIN) anyway, so dropping the metadata
// never widens access.
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

  private validateLimit(limit: number): number {
    if (limit < 1) {
      throw new BadRequestException("Limit must be at least 1");
    }
    if (limit > MAX_LIMIT) {
      throw new BadRequestException(`Limit cannot exceed ${MAX_LIMIT}`);
    }
    return limit;
  }

  private validatePage(page: number): number {
    if (page < 1) {
      throw new BadRequestException("Page must be at least 1");
    }
    return page;
  }

  private validateDateWindow(startDate?: string, endDate?: string): void {
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const diffDays =
        (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays > MAX_DATE_WINDOW_DAYS) {
        throw new BadRequestException(
          `Date range cannot exceed ${MAX_DATE_WINDOW_DAYS} days`,
        );
      }
    }
  }

  @Get("stats")
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
    @Query() query: DashboardStatsQueryDto,
  ): Promise<any> {
    this.validateDateWindow(query.startDate, query.endDate);
    return this.adminService.getDashboardStats(request.userSession, {
      startDate: query.startDate,
      endDate: query.endDate,
      assignmentId: query.assignmentId ? Number(query.assignmentId) : undefined,
      assignmentName: query.assignmentName,
      userId: query.userId,
    });
  }
  @Get("quick-actions/:action")
  @ApiOperation({
    summary: "Execute predefined quick actions for dashboard insights",
  })
  @ApiQuery({
    name: "limit",
    required: false,
    type: Number,
    description: `Maximum ${MAX_LIMIT}`,
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403 })
  async executeQuickAction(
    @Req() request: AdminSessionRequest,
    @Param("action") action: string,
    @Query("limit", new DefaultValuePipe(DEFAULT_LIMIT), ParseIntPipe)
    limit: number,
  ): Promise<any> {
    const validatedLimit = this.validateLimit(limit);
    return this.adminService.executeQuickAction(
      request.adminSession,
      action,
      validatedLimit,
    );
  }

  /**
   * Get assignment analytics with detailed insights
   */
  @Get("analytics")
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary:
      "Get detailed assignment analytics with insights (for authors and admins)",
  })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({
    name: "limit",
    required: false,
    type: Number,
    description: `Maximum ${MAX_LIMIT}`,
  })
  @ApiQuery({ name: "search", required: false, type: String })
  @ApiQuery({
    name: "details",
    required: false,
    type: Boolean,
    description: "Include detailed cost breakdown",
  })
  @ApiQuery({
    name: "sortBy",
    required: false,
    enum: ANALYTICS_SORT_FIELDS,
  })
  @ApiQuery({
    name: "sortOrder",
    required: false,
    enum: ["asc", "desc"],
  })
  @ApiQuery({ name: "published", required: false, type: Boolean })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403 })
  async getAssignmentAnalytics(
    @Req() request: UserSessionRequest,
    @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query("limit", new DefaultValuePipe(DEFAULT_LIMIT), ParseIntPipe)
    limit: number,
    @Query("search") search?: string,
    @Query("details", new DefaultValuePipe(false), ParseBoolPipe)
    details?: boolean,
    @Query("sortBy") sortBy?: string,
    @Query("sortOrder") sortOrder?: string,
    @Query("published", new ParseBoolPipe({ optional: true }))
    published?: boolean,
  ): Promise<AssignmentAnalyticsResponse> {
    const validatedPage = this.validatePage(page);
    const validatedLimit = this.validateLimit(limit);
    const validatedSortBy = this.validateSortBy(sortBy);
    const validatedSortOrder = this.validateSortOrder(sortOrder);
    return await this.adminService.getAssignmentAnalytics(
      request.userSession,
      validatedPage,
      validatedLimit,
      search,
      details,
      validatedSortBy,
      validatedSortOrder,
      published,
    );
  }

  private validateSortBy(sortBy?: string): AnalyticsSortField | undefined {
    if (sortBy === undefined) return undefined;
    if ((ANALYTICS_SORT_FIELDS as readonly string[]).includes(sortBy)) {
      return sortBy as AnalyticsSortField;
    }
    throw new BadRequestException(
      `sortBy must be one of: ${ANALYTICS_SORT_FIELDS.join(", ")}`,
    );
  }

  private validateSortOrder(sortOrder?: string): "asc" | "desc" | undefined {
    if (sortOrder === undefined) return undefined;
    if (sortOrder === "asc" || sortOrder === "desc") return sortOrder;
    throw new BadRequestException(`sortOrder must be "asc" or "desc"`);
  }

  /**
   * Get detailed insights for a specific assignment
   */
  @Get("assignments/:id/insights")
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: "Get detailed insights for a specific assignment",
  })
  @ApiQuery({
    name: "details",
    required: false,
    type: Boolean,
    description: "Include detailed cost breakdown and question insights",
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 404 })
  async getDetailedAssignmentInsights(
    @Req() request: UserSessionRequest,
    @Param("id", ParseIntPipe) id: number,
    @Query("details", new DefaultValuePipe(false), ParseBoolPipe)
    details?: boolean,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return await this.adminService.getDetailedAssignmentInsights(
      request.userSession,
      id,
      details,
    );
  }

  /**
   * Manual cleanup of old drafts
   */
  @Post("cleanup/drafts")
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
