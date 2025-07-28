/* eslint-disable unicorn/no-null */
import { Injectable } from "@nestjs/common";
import { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import { CreateQuestionResponseAttemptResponseDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import { PrismaService } from "../../../../prisma.service";

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
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a grading action for audit purposes
   * @param record The grading record to store
   */
  async recordGrading(record: GradingAuditRecord): Promise<void> {
    try {
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
    } catch {
      console.error("Error recording grading audit:", record);
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
}
