import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  ParseIntPipe,
  Post,
  Query,
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
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { AdminGuard } from "src/auth/guards/admin.guard";
import { UserSessionRequest } from "src/auth/interfaces/user.session.interface";
import { ForcePassAttemptDto } from "../dto/force-pass-attempt.dto";
import { AttemptAdminService } from "../services/attempt-admin.service";

@ApiTags("Admin Attempts")
// AdminGuard protects this controller and preserves cookie-session routing.
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

  @Get()
  @ApiOperation({
    summary: "List every attempt belonging to one learner (ADMIN)",
  })
  @ApiQuery({ name: "userId", required: true, type: String })
  @ApiResponse({ status: 200, description: "Attempts for the learner" })
  @ApiResponse({ status: 403, description: "Not an admin" })
  async listForUser(@Query("userId") userId?: string) {
    const trimmed = userId?.trim();
    // Reject empty userId values to prevent unbounded learner queries.
    if (!trimmed) {
      throw new BadRequestException("userId is required");
    }
    return this.attemptAdminService.listAttemptsForUser(trimmed);
  }

  @Delete(":attemptId")
  // Rate-limit destructive actions consistently with force-pass.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary:
      "Delete an attempt, freeing one of the learner's attempts so they can restart (ADMIN)",
  })
  @ApiParam({ name: "attemptId", required: true, type: Number })
  @ApiResponse({ status: 200, description: "Attempt deleted" })
  @ApiResponse({ status: 403, description: "Not an admin" })
  @ApiResponse({ status: 404, description: "Attempt not found" })
  async deleteAttempt(
    @Param("attemptId", ParseIntPipe) attemptId: number,
    @Req() request: UserSessionRequest,
  ) {
    const adminEmail = request.userSession?.userId ?? "unknown";
    return this.attemptAdminService.deleteAttempt(attemptId, adminEmail);
  }

  @Post(":attemptId/force-pass")
  // Rate-limit mutating override actions consistently with admin writes.
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
