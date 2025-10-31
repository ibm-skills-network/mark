/* eslint-disable unicorn/no-null */
import { Inject, Injectable } from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import { CreateQuestionResponseAttemptResponseDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import { Logger } from "winston";
import { PrismaService } from "../../../../database/prisma.service";

/**
 * Interface for grading audit records
 */
export interface GradingAuditRecord {
  questionId: number;
  assignmentId?: number;
  requestDto: CreateQuestionResponseAttemptRequestDto;
  responseDto: CreateQuestionResponseAttemptResponseDto;
  gradingStrategy: string;
  metadata?: Record<string, any>;
}
export interface GradingIssue {
  type: string;
  description: string;
  severity: "low" | "medium" | "high";
}
/**
 * Service for auditing grading activities
 * This allows tracking how questions are graded for quality control and improvement
 */
@Injectable()
export class GradingAuditService {
  private readonly logger: Logger;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({
      context: GradingAuditService.name,
    });
  }

  /**
   * Record a grading action for audit purposes
   * @param record The grading record to store
   */
  /**
   * Record grading for audit purposes (non-blocking)
   * This method will not throw errors to prevent grading failures
   */
  async recordGrading(record: GradingAuditRecord): Promise<void> {
    try {
      this.logger.info("Recording grading audit", {
        questionId: record.questionId,
        assignmentId: record.assignmentId,
        gradingStrategy: record.gradingStrategy,
        metadata: record.metadata,
      });

      await this.prisma.gradingAudit.create({
        data: {
          questionId: record.questionId,
          assignmentId: record.assignmentId,
          requestPayload: JSON.stringify(record.requestDto),
          responsePayload: JSON.stringify(record.responseDto),
          gradingStrategy: record.gradingStrategy,
          metadata: record.metadata ? JSON.stringify(record.metadata) : null,
          timestamp: new Date(),
        },
      });

      this.logger.info("Successfully recorded grading audit", {
        questionId: record.questionId,
        assignmentId: record.assignmentId,
        gradingStrategy: record.gradingStrategy,
      });
    } catch (error) {
      this.logger.error(
        "Failed to record grading audit - continuing grading process",
        {
          error: error instanceof Error ? error.message : String(error),
          questionId: record.questionId,
          assignmentId: record.assignmentId,
          gradingStrategy: record.gradingStrategy,
          stack: error instanceof Error ? error.stack : undefined,
          record: {
            questionId: record.questionId,
            assignmentId: record.assignmentId,
            gradingStrategy: record.gradingStrategy,
          },
        },
      );
    }
  }

  /**
   * Get grading history for a question
   * @param questionId The ID of the question
   * @param limit Maximum number of records to return
   * @returns Array of grading audit records
   */
  async getGradingHistoryForQuestion(
    questionId: number,
    limit = 10,
  ): Promise<any[]> {
    return this.prisma.gradingAudit.findMany({
      where: { questionId },
      orderBy: { timestamp: "desc" },
      take: limit,
    });
  }

  /**
   * Get statistics on grading for a question
   * @param questionId The ID of the question
   * @returns Statistics including average score, score distribution, etc.
   */
  async getGradingStatistics(questionId: number): Promise<any> {
    const audits = await this.prisma.gradingAudit.findMany({
      where: { questionId },
    });

    if (audits.length === 0) {
      return {
        questionId,
        totalAttempts: 0,
        averageScore: 0,
        distribution: {},
      };
    }

    const scores = audits.map((audit) => {
      try {
        const response = JSON.parse(audit.responsePayload) as {
          totalPoints?: number;
        };
        return response.totalPoints || 0;
      } catch {
        return 0;
      }
    });

    const totalScore = scores.reduce((sum, score) => sum + score, 0);
    const averageScore = totalScore / scores.length;

    const distribution: Record<number, number> = {};
    for (const score of scores) {
      distribution[score] = (distribution[score] || 0) + 1;
    }

    return {
      questionId,
      totalAttempts: audits.length,
      averageScore,
      distribution,
    };
  }

  /**
   * Identify potential grading issues based on patterns
   * @param questionId The ID of the question to analyze
   * @returns Array of potential issues identified
   */
  async identifyGradingIssues(questionId: number): Promise<GradingIssue[]> {
    const audits = await this.prisma.gradingAudit.findMany({
      where: { questionId },
      orderBy: { timestamp: "desc" },
      take: 100,
    });

    if (audits.length < 10) {
      return [];
    }

    const issues: GradingIssue[] = [];

    const scores = audits.map((audit) => {
      try {
        const parsedResponse = JSON.parse(audit.responsePayload) as {
          totalPoints?: number;
        };
        const response: { totalPoints?: number } =
          typeof parsedResponse === "object" && parsedResponse !== null
            ? parsedResponse
            : {};
        return response.totalPoints || 0;
      } catch {
        return 0;
      }
    });

    const zeroCount = scores.filter((score) => score === 0).length;
    if (zeroCount / scores.length > 0.4) {
      issues.push({
        type: "excessive_zeros",
        description: `${zeroCount} out of ${scores.length} responses scored 0 points`,
        severity: "high",
      });
    }

    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      select: { totalPoints: true },
    });

    if (question) {
      const maxScore = question.totalPoints;
      const maxScoreCount = scores.filter((score) => score === maxScore).length;

      if (maxScoreCount / scores.length > 0.6) {
        issues.push({
          type: "excessive_max_scores",
          description: `${maxScoreCount} out of ${scores.length} responses scored maximum points`,
          severity: "medium",
        });
      }
    }

    return issues;
  }

  /**
   * Get grading architecture usage statistics
   */
  async getGradingUsageStatistics(timeRange?: {
    from: Date;
    to: Date;
  }): Promise<{
    totalGradings: number;
    strategiesByCount: { strategy: string; count: number }[];
    gradingsByDay: { date: string; count: number }[];
    averagePointsAwarded: number;
    mostActiveQuestions: { questionId: number; count: number }[];
    errorRate: number;
  }> {
    const whereClause = timeRange
      ? {
          timestamp: {
            gte: timeRange.from,
            lte: timeRange.to,
          },
        }
      : {};

    try {
      const totalGradings = await this.prisma.gradingAudit.count({
        where: whereClause,
      });

      const strategyCounts = await this.prisma.gradingAudit.groupBy({
        by: ["gradingStrategy"],
        where: whereClause,
        _count: {
          id: true,
        },
        orderBy: {
          _count: {
            id: "desc",
          },
        },
      });

      const strategiesByCount = strategyCounts.map((item) => ({
        strategy: item.gradingStrategy,
        count: item._count.id,
      }));

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const dailyCounts = await this.prisma.gradingAudit.groupBy({
        by: ["timestamp"],
        where: {
          ...whereClause,
          timestamp: {
            gte: sevenDaysAgo,
          },
        },
        _count: {
          id: true,
        },
      });

      const gradingsByDay: { [key: string]: number } = {};
      for (const item of dailyCounts) {
        const date = item.timestamp.toISOString().split("T")[0];
        gradingsByDay[date] = (gradingsByDay[date] || 0) + item._count.id;
      }

      const gradingsByDayArray = Object.entries(gradingsByDay).map(
        ([date, count]) => ({
          date,
          count: count,
        }),
      );

      const averagePointsAwarded = 0;

      const questionCounts = await this.prisma.gradingAudit.groupBy({
        by: ["questionId"],
        where: whereClause,
        _count: {
          id: true,
        },
        orderBy: {
          _count: {
            id: "desc",
          },
        },
        take: 10,
      });

      const mostActiveQuestions = questionCounts.map((item) => ({
        questionId: item.questionId,
        count: item._count.id,
      }));

      const errorRate = 0;

      this.logger.info("Generated grading usage statistics", {
        totalGradings,
        strategiesCount: strategiesByCount.length,
        timeRange,
      });

      return {
        totalGradings,
        strategiesByCount,
        gradingsByDay: gradingsByDayArray,
        averagePointsAwarded,
        mostActiveQuestions,
        errorRate,
      };
    } catch (error) {
      this.logger.error("Failed to generate grading usage statistics", {
        error: error instanceof Error ? error.message : String(error),
        timeRange,
      });
      throw error;
    }
  }

  /**
   * Log architecture usage summary (call this periodically)
   */
  async logArchitectureUsageSummary(): Promise<void> {
    try {
      const stats = await this.getGradingUsageStatistics();

      this.logger.info("=== GRADING ARCHITECTURE USAGE SUMMARY ===", {
        totalGradingsRecorded: stats.totalGradings,
        activeStrategies: stats.strategiesByCount.length,
        topStrategies: stats.strategiesByCount.slice(0, 3),
        mostActiveQuestions: stats.mostActiveQuestions.slice(0, 3),
        recentActivity:
          stats.gradingsByDay.length > 0 ? "Active" : "No recent activity",
      });

      if (stats.totalGradings === 0) {
        this.logger.warn(
          "⚠️  NO GRADING AUDIT RECORDS FOUND - Grading may not be working or strategies are not calling recordGrading",
        );
      } else {
        this.logger.info(
          "✅ Grading architecture is actively being used and recorded",
        );
      }
    } catch (error) {
      this.logger.error("Failed to log architecture usage summary", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
