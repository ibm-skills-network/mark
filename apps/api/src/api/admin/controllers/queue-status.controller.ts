import {
  Controller,
  Get,
  Logger,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AdminGuard } from "src/auth/guards/admin.guard";
import { UserRole } from "src/auth/interfaces/user.session.interface";
import { Roles } from "src/auth/role/roles.global.guard";
import {
  FailedJobDto,
  QueueStatDto,
  QueueStatusService,
  WorkerDto,
} from "../services/queue-status.service";

const DEFAULT_FAILED_LIMIT = 25;

@ApiTags("Admin Queue Status")
@UseGuards(AdminGuard)
@ApiBearerAuth()
// NOTE: path is intentionally NOT under "admin/..." — the api-gateway guards
// "/admin/*" with a JWT *bearer* admin token, whereas the admin dashboard
// authenticates with the cookie session + x-admin-token. Living under
// "admin-dashboard/..." routes through the same gateway path as the working
// admin-dashboard endpoints and reaches mark-api's AdminGuard.
@Controller({ path: "admin-dashboard/queue-status", version: "1" })
export class QueueStatusController {
  private readonly logger = new Logger(QueueStatusController.name);

  constructor(private readonly queueStatusService: QueueStatusService) {}

  @Get()
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @ApiOperation({ summary: "Live queue counts + worker pod health" })
  async getStatus(): Promise<{
    generatedAt: string;
    queues: QueueStatDto[];
    workers: WorkerDto[];
  }> {
    const [queues, workers] = await Promise.all([
      this.queueStatusService.getQueueStats(),
      this.queueStatusService.getWorkers(),
    ]);
    this.logger.log(
      `queue-status read: ${queues.length} queues, ${workers.length} workers`,
    );
    return { generatedAt: new Date().toISOString(), queues, workers };
  }

  @Get(":queueName/failed")
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @ApiOperation({ summary: "Recent failed jobs for one queue" })
  async getFailed(
    @Param("queueName") queueName: string,
    @Query("limit") limit?: string,
  ): Promise<{ queueName: string; failed: FailedJobDto[] }> {
    const parsed = Number.parseInt(limit ?? "", 10);
    const requested = Number.isFinite(parsed) ? parsed : DEFAULT_FAILED_LIMIT;
    const failed = await this.queueStatusService.getFailedJobs(
      queueName,
      requested,
    );
    this.logger.log(
      `queue-status failed read: queue=${queueName} returned=${failed.length}`,
    );
    return { queueName, failed };
  }
}
