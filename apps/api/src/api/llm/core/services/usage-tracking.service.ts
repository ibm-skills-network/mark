import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { AIUsageType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { PrismaService } from "src/database/prisma.service";
import { Logger } from "winston";
import {
  IUsageTracker,
  UsageDetail,
} from "../interfaces/user-tracking.interface";
import { toAiUsageCounterBigInt } from "../utils/ai-usage-counter.util";

@Injectable()
export class UsageTrackerService implements IUsageTracker {
  private readonly logger: Logger;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: UsageTrackerService.name });
  }

  /**
   * Track LLM usage: the daily ledger first, so spend is recorded even if the
   * assignment is gone, then the assignment's running totals.
   */
  async trackUsage(
    assignmentId: number | null,
    usageType: AIUsageType,
    tokensIn: number,
    tokensOut: number,
    modelKey?: string,
    detail: UsageDetail = {},
  ): Promise<void> {
    try {
      await this.recordDaily(
        assignmentId,
        usageType,
        tokensIn,
        tokensOut,
        modelKey,
        detail,
      );
      if (assignmentId === null) return;

      const assignmentIdToDatabase = Number(assignmentId);
      const tokensInToStore = toAiUsageCounterBigInt(tokensIn, "tokensIn");
      const tokensOutToStore = toAiUsageCounterBigInt(tokensOut, "tokensOut");
      const assignmentExists = await this.prisma.assignment.findUnique({
        where: { id: assignmentIdToDatabase },
      });

      if (!assignmentExists) {
        throw new HttpException(
          `Assignment with ID ${assignmentIdToDatabase} does not exist`,
          HttpStatus.BAD_REQUEST,
        );
      }

      await this.prisma.aIUsage.upsert({
        where: {
          assignmentId_usageType: {
            assignmentId: assignmentIdToDatabase,
            usageType,
          },
        },
        update: {
          tokensIn: { increment: tokensInToStore },
          tokensOut: { increment: tokensOutToStore },
          usageCount: { increment: BigInt(1) },
          updatedAt: new Date(),
          ...(modelKey && { modelKey }),
        },
        create: {
          assignmentId: assignmentIdToDatabase,
          usageType,
          tokensIn: tokensInToStore,
          tokensOut: tokensOutToStore,
          usageCount: BigInt(1),
          createdAt: new Date(),
          updatedAt: new Date(),
          modelKey,
        },
      });

      this.logger.debug(
        `Tracked usage for assignment ${assignmentIdToDatabase}: ${tokensIn} in, ${tokensOut} out (${usageType})`,
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(
        `Failed to track AI usage: ${(error as Error).message}`,
      );
      throw new HttpException(
        "Failed to track AI usage",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /** One row per UTC day, type, model and assignment; counters only grow. */
  private async recordDaily(
    assignmentId: number | null,
    usageType: AIUsageType,
    tokensIn: number,
    tokensOut: number,
    modelKey: string | undefined,
    detail: UsageDetail,
  ): Promise<void> {
    try {
      const now = new Date();
      const key = {
        day: new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
        ),
        usageType,
        modelKey: modelKey ?? "unknown",
        assignmentId: assignmentId ?? 0,
      };
      const counters = {
        inputTokens: toAiUsageCounterBigInt(tokensIn, "tokensIn"),
        cachedInputTokens: toAiUsageCounterBigInt(
          detail.cachedInputTokens ?? 0,
          "cachedInputTokens",
        ),
        outputTokens: toAiUsageCounterBigInt(tokensOut, "tokensOut"),
        calls: BigInt(1),
        failedCalls: BigInt(detail.failed ? 1 : 0),
      };
      await this.prisma.aIUsageDaily.upsert({
        where: { day_usageType_modelKey_assignmentId: key },
        create: { ...key, ...counters },
        update: {
          inputTokens: { increment: counters.inputTokens },
          cachedInputTokens: { increment: counters.cachedInputTokens },
          outputTokens: { increment: counters.outputTokens },
          calls: { increment: counters.calls },
          failedCalls: { increment: counters.failedCalls },
        },
      });
    } catch (error) {
      // Never costs the caller its response or the assignment's totals.
      this.logger.error(
        `Failed to record daily AI usage: ${(error as Error).message}`,
      );
    }
  }
}
