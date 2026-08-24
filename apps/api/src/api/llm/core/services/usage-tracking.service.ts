import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { AIUsageType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { PrismaService } from "src/database/prisma.service";
import { Logger } from "winston";
import { IUsageTracker } from "../interfaces/user-tracking.interface";
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
   * Track LLM usage for a specific assignment and usage type
   * Stores token counts and increments usage count
   */
  async trackUsage(
    assignmentId: number,
    usageType: AIUsageType,
    tokensIn: number,
    tokensOut: number,
    modelKey?: string,
    cachedTokensIn = 0,
  ): Promise<void> {
    try {
      const assignmentIdToDatabase = Number(assignmentId);
      const tokensInToStore = toAiUsageCounterBigInt(tokensIn, "tokensIn");
      const tokensOutToStore = toAiUsageCounterBigInt(tokensOut, "tokensOut");
      const cachedTokensInToStore = toAiUsageCounterBigInt(
        cachedTokensIn,
        "cachedTokensIn",
      );
      if (cachedTokensIn > tokensIn) {
        throw new HttpException(
          "Cached input tokens cannot exceed total input tokens",
          HttpStatus.BAD_REQUEST,
        );
      }
      const assignmentExists = await this.prisma.assignment.findUnique({
        where: { id: assignmentIdToDatabase },
      });

      if (!assignmentExists) {
        throw new HttpException(
          `Assignment with ID ${assignmentIdToDatabase} does not exist`,
          HttpStatus.BAD_REQUEST,
        );
      }

      // Write the immutable event and legacy aggregate atomically.
      await this.prisma.$transaction([
        this.prisma.aIUsageEvent.create({
          data: {
            assignmentId: assignmentIdToDatabase,
            usageType,
            tokensIn: tokensInToStore,
            cachedTokensIn: cachedTokensInToStore,
            tokensOut: tokensOutToStore,
            modelKey: modelKey || "unknown",
            createdAt: new Date(),
          },
        }),
        this.prisma.aIUsage.upsert({
          where: {
            assignmentId_usageType: {
              assignmentId: assignmentIdToDatabase,
              usageType,
            },
          },
          update: {
            tokensIn: { increment: tokensInToStore },
            cachedTokensIn: { increment: cachedTokensInToStore },
            tokensOut: { increment: tokensOutToStore },
            usageCount: { increment: BigInt(1) },
            updatedAt: new Date(),
            ...(modelKey && { modelKey }),
          },
          create: {
            assignmentId: assignmentIdToDatabase,
            usageType,
            tokensIn: tokensInToStore,
            cachedTokensIn: cachedTokensInToStore,
            tokensOut: tokensOutToStore,
            usageCount: BigInt(1),
            createdAt: new Date(),
            updatedAt: new Date(),
            modelKey,
          },
        }),
      ]);

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
}
