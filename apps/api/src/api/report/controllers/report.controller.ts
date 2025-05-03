// report.controller.ts
import { Body, Controller, Post, Req } from "@nestjs/common";
import { ReportsService } from "../services/report.service";
import {
  RegradeRequestDto,
  ReportIssueDto,
  UserFeedbackDto,
} from "../types/report.types";
import { UserSessionRequest } from "src/auth/interfaces/user.session.interface";

@Controller({
  path: "reports",
  version: "1",
})
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /**
   * POST /reports
   *
   * Reports an issue from the Mark chat to both GitHub and Flo
   */
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
      additionalDetails?: Record<string, any>;
    },
    @Req() request: UserSessionRequest,
  ): Promise<{ message: string; issueNumber?: number }> {
    return this.reportsService.reportIssue(dto, request.userSession);
  }

  /**
   * POST /reports/regrade
   *
   * Submits a regrade request to Flo
   */
  // @Post("regrade")
  // async requestRegrade(
  //   @Body() dto: RegradeRequestDto,
  // ): Promise<{ message: string }> {
  //   return this.reportsService.handleRegradeRequest(
  //     dto.assignmentId,
  //     dto.attemptId,
  //     dto.reason,
  //     dto.userEmail,
  //     dto.role,
  //   );
  // }

  /**
   * POST /reports/feedback
   *
   * Submits user feedback about the platform to Flo
   */
  @Post("feedback")
  async submitFeedback(
    @Body() dto: UserFeedbackDto,
  ): Promise<{ message: string }> {
    return this.reportsService.sendUserFeedback(
      dto.title,
      dto.description,
      dto.rating,
      dto.userEmail,
      dto.portalName,
    );
  }
}
