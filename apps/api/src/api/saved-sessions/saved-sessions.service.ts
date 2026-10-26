import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../database/prisma.service";

const DEFAULT_RETENTION_DAYS = 3;

export interface SavedSessionKey {
  storeId: string;
  role: "author" | "learner";
  assignmentId: number;
}

@Injectable()
export class SavedSessionsService {
  private readonly logger = new Logger(SavedSessionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async find(key: SavedSessionKey): Promise<string | undefined> {
    const row = await this.prisma.savedSession.findUnique({
      where: { storeId_role_assignmentId: key },
      select: { token: true },
    });
    return row?.token;
  }

  async save(key: SavedSessionKey, token: string): Promise<void> {
    await this.prisma.savedSession.upsert({
      where: { storeId_role_assignmentId: key },
      create: { ...key, token },
      update: { token },
    });
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async prune(): Promise<void> {
    if (process.env.ENABLE_JOB_SCHEDULERS !== "true") return;
    const configured = Number(process.env.SAVED_SESSION_RETENTION_DAYS);
    const days =
      Number.isFinite(configured) && configured > 0
        ? configured
        : DEFAULT_RETENTION_DAYS;
    try {
      const { count } = await this.prisma.savedSession.deleteMany({
        where: {
          updatedAt: { lt: new Date(Date.now() - days * 24 * 60 * 60 * 1000) },
        },
      });
      this.logger.log(`Pruned ${count} saved sessions older than ${days} days`);
    } catch (error) {
      this.logger.error("Failed to prune saved sessions", error);
    }
  }
}
