import {
  Body,
  Controller,
  Logger,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { AdminGuard } from "src/auth/guards/admin.guard";
import { UserSessionRequest } from "src/auth/interfaces/user.session.interface";
import { ForcePassAttemptDto } from "../dto/force-pass-attempt.dto";
import { AttemptAdminService } from "../services/attempt-admin.service";

@ApiTags("Admin Attempts")
// AdminGuard covers the whole controller and is the single source of truth for
// access (it rejects any non-admin session). Lives under "admin-dashboard/..."
// — not "admin/..." — so it routes through the same api-gateway path as the
// other admin-dashboard endpoints (cookie session + x-admin-token) and reaches
// mark-api's AdminGuard, rather than the gateway's JWT-bearer "/admin/*" guard.
@UseGuards(AdminGuard)
@ApiBearerAuth()
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
@Controller({ path: "admin-dashboard/attempts", version: "1" })
export class AttemptAdminController {
  private readonly logger = new Logger(AttemptAdminController.name);

  constructor(private readonly attemptAdminService: AttemptAdminService) {}

  @Post(":attemptId/force-pass")
  // Mutating override action: rate-limit per admin in line with the other
  // admin write actions (queue retry/remove).
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: "Manually pass an attempt (set grade + mark submitted) (ADMIN)",
  })
  @ApiParam({ name: "attemptId", required: true, type: Number })
  @ApiBody({ type: ForcePassAttemptDto, required: false })
  @ApiResponse({ status: 201, description: "Attempt force-passed" })
  @ApiResponse({ status: 403, description: "Not an admin" })
  @ApiResponse({ status: 404, description: "Attempt not found" })
  async forcePass(
    @Param("attemptId", ParseIntPipe) attemptId: number,
    @Body() body: ForcePassAttemptDto,
    @Req() request: UserSessionRequest,
  ) {
    const adminEmail = request.userSession?.userId ?? "unknown";
    const gradePercent = body.gradePercent ?? 100;
    return this.attemptAdminService.forcePass(
      attemptId,
      gradePercent,
      adminEmail,
    );
  }
}
