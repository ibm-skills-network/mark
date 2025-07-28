import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { AIUsageType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { PrismaService } from "src/prisma.service";
import { Logger } from "winston";
import { IUsageTracker } from "../interfaces/user-tracking.interface";

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
  ): Promise<void> {
    try {
      const assignmentIdToDatabase = Number(assignmentId);
      console.log(
        `Tracking usage for assignment ID: ${assignmentIdToDatabase}, usage type: ${usageType}, tokens in: ${tokensIn}, tokens out: ${tokensOut}`,
      );
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
          tokensIn: { increment: tokensIn },
          tokensOut: { increment: tokensOut },
          usageCount: { increment: 1 },
          updatedAt: new Date(),
        },
        create: {
          assignmentId: assignmentIdToDatabase,
          usageType,
          tokensIn,
          tokensOut,
          usageCount: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
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
}
