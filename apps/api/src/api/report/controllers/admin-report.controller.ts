import { Body, Controller, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { UserSessionRequest } from "src/auth/interfaces/user.session.interface";
import { ReportsService } from "../services/report.service";
import { BugRenewalEmailDto } from "../types/report.types";

/**
 * Admin-only report actions intended for programmatic callers (e.g. CI).
 *
 * Routes live under `/v1/admin/reports`, which the API gateway protects with
 * the bearer-token guard (a prod admin JWT with `admin: true`). As with the
 * other `/admin/*` controllers, there is intentionally no downstream guard
 * here: the gateway is the gatekeeper and forwards an injected `user-session`.
 */
@ApiTags("Reports")
@ApiBearerAuth()
@Controller({
  path: "admin/reports",
  version: "1",
})
export class AdminReportsController {
  private readonly logger: Logger;

  constructor(
    private readonly reportsService: ReportsService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: AdminReportsController.name });
  }

  @Post("renewal-email")
  // Endpoint-scoped rate limit: this route sends email and is the CI entry
  // point. ThrottlerGuard/@Throttle apply here only — other report routes are
  // unaffected. The throttle keys by client IP, and behind the gateway that is
  // a single shared bucket, so the limit covers total legitimate volume (a CI
  // run makes ~25 calls; 60/min leaves headroom for retries/overlap).
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: "Send bug renewal email for a report issue",
  })
  async sendBugRenewalEmail(
    @Body() dto: BugRenewalEmailDto,
    @Req() request: UserSessionRequest,
  ) {
    const actorUserId = this.forwardedActorId(request);
    const requestId =
      request.get("akamai-grn") ?? request.get("x-request-id") ?? undefined;

    const result = await this.reportsService.sendBugRenewalEmail(dto);

    this.logger.info("admin_renewal_email", {
      actor_user_id: actorUserId,
      issue_number: dto.issueNumber,
      report_id: result.reportId,
      sent: result.success,
      skipped: result.skipped ?? false,
      request_id: requestId,
    });

    return result;
  }

  /**
   * Resolve the acting identity from the gateway-injected `user-session`
   * header. UserSessionMiddleware does not run on `/v1/admin/reports`, so we
   * parse the forwarded header directly (same approach as AdminController).
   */
  private forwardedActorId(request: UserSessionRequest): string {
    const raw = request.headers["user-session"];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== "string" || value.length === 0) {
      return "unknown";
    }
    try {
      const parsed = JSON.parse(value) as { userId?: unknown };
      return typeof parsed.userId === "string" &&
        parsed.userId.trim().length > 0
        ? parsed.userId
        : "unknown";
    } catch {
      return "unknown";
    }
  }
}
