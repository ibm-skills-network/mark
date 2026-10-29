import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { AdminGuard } from "src/auth/guards/admin.guard";
import { UserSessionRequest } from "src/auth/interfaces/user.session.interface";
import { EmailSuppressionService } from "src/auth/services/email-suppression.service";
import {
  CreateEmailSuppressionDto,
  ListEmailSuppressionsQueryDto,
  ReleaseEmailHoldDto,
} from "../dto/email-suppression.dto";

@ApiTags("Admin Email Suppressions")
// Addresses Mark will not email. Permanent bounces seen at send time are
// added automatically, including invalid mailboxes from IBM bounce polling.
// AdminGuard covers the whole controller and lives under
// "admin-dashboard/..." for the same gateway routing as AttemptAdminController.
@UseGuards(AdminGuard)
@ApiBearerAuth()
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
@Controller({ path: "admin-dashboard/email-suppressions", version: "1" })
export class EmailSuppressionController {
  private readonly logger = new Logger(EmailSuppressionController.name);

  constructor(private readonly suppressions: EmailSuppressionService) {}

  @Get("bounce-health")
  @ApiOperation({ summary: "Bounce poll status and domain warnings (ADMIN)" })
  bounceHealth() {
    return this.suppressions.bounceHealth();
  }

  @Get("temporary-holds")
  @ApiOperation({ summary: "List automatic temporary email holds (ADMIN)" })
  temporaryHolds(@Query() query: ListEmailSuppressionsQueryDto) {
    return this.suppressions.listTemporaryHolds(
      query.page ?? 1,
      query.limit ?? 25,
      query.search,
    );
  }

  @Post("temporary-holds/release")
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: "Override a temporary email hold (ADMIN)" })
  async releaseTemporaryHold(
    @Body() body: ReleaseEmailHoldDto,
    @Req() request: UserSessionRequest,
  ) {
    const released = await this.suppressions.releaseTemporaryHold(
      body.email,
      request.userSession?.userId ?? "unknown",
    );
    if (!released) throw new NotFoundException("Temporary hold not found");
    return { released: true };
  }

  @Get()
  @ApiOperation({ summary: "List suppressed email addresses (ADMIN)" })
  async list(
    @Query() query: ListEmailSuppressionsQueryDto,
    @Req() request: UserSessionRequest,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    this.logger.log(
      `email-suppressions list: admin=${request.userSession?.userId ?? "unknown"} page=${page}`,
    );
    const { items, total } = await this.suppressions.list(
      page,
      limit,
      query.search,
    );
    return { items, total, page, limit };
  }

  @Post()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: "Suppress an email address (ADMIN)" })
  async create(
    @Body() body: CreateEmailSuppressionDto,
    @Req() request: UserSessionRequest,
  ) {
    const adminEmail = request.userSession?.userId ?? "unknown";
    return this.suppressions.suppress(
      body.email,
      body.reason,
      body.note,
      adminEmail,
    );
  }

  @Delete(":id")
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: "Remove a suppression so the address gets email again (ADMIN)",
  })
  async remove(
    @Param("id", ParseIntPipe) id: number,
    @Req() request: UserSessionRequest,
  ) {
    const adminEmail = request.userSession?.userId ?? "unknown";
    const removed = await this.suppressions.remove(id, adminEmail);
    if (!removed) {
      throw new NotFoundException("Suppression not found");
    }
    return { removed: true, id };
  }
}
