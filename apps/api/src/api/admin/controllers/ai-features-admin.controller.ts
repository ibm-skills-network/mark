import {
  Body,
  Controller,
  Get,
  Logger,
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
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { AdminGuard } from "src/auth/guards/admin.guard";
import { UserSessionRequest } from "src/auth/interfaces/user.session.interface";
import { AiFeatureFlagsService } from "../../ai-feature-flags/ai-feature-flags.service";
import { SetAiFeatureDto } from "../dto/set-ai-feature.dto";

/**
 * Admin runtime control for the AI kill-switch. Lives under "admin-dashboard/..."
 * so it routes through the same path (cookie session + x-admin-token) as the
 * other admin-dashboard endpoints and reaches mark-api's AdminGuard.
 */
@ApiTags("Admin AI Features")
@UseGuards(AdminGuard)
@ApiBearerAuth()
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
@Controller({ path: "admin-dashboard/ai-features", version: "1" })
export class AiFeaturesAdminController {
  private readonly logger = new Logger(AiFeaturesAdminController.name);

  constructor(private readonly aiFlags: AiFeatureFlagsService) {}

  @Get()
  @ApiOperation({ summary: "List AI component kill-switch states (ADMIN)" })
  @ApiResponse({ status: 200, description: "Per-component flag states" })
  @ApiResponse({ status: 403, description: "Not an admin" })
  async list() {
    return this.aiFlags.getAllFlags();
  }

  @Post()
  // Mutating action: rate-limit per admin, in line with the other admin writes.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: "Enable or disable an AI component at runtime (ADMIN)",
  })
  @ApiBody({ type: SetAiFeatureDto })
  @ApiResponse({
    status: 201,
    description: "Updated per-component flag states",
  })
  @ApiResponse({ status: 403, description: "Not an admin" })
  async set(@Body() body: SetAiFeatureDto, @Req() request: UserSessionRequest) {
    const adminEmail = request.userSession?.userId ?? "unknown";
    // Audit the override (the service also logs structurally with the value).
    this.logger.warn(
      `AI kill-switch toggle: component=${body.component} enabled=${String(body.enabled)} by=${adminEmail}`,
    );
    return this.aiFlags.setEnabled(body.component, body.enabled, adminEmail);
  }
}
