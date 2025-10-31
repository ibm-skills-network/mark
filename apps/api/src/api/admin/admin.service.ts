/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  UserRole,
  UserSession,
} from "../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../database/prisma.service";
import { LLMPricingService } from "../llm/core/services/llm-pricing.service";
import { LLM_PRICING_SERVICE } from "../llm/llm.constants";
import { AdminAddAssignmentToGroupResponseDto } from "./dto/assignment/add.assignment.to.group.response.dto";
import { BaseAssignmentResponseDto } from "./dto/assignment/base.assignment.response.dto";
import {
  AdminCreateAssignmentRequestDto,
  AdminReplaceAssignmentRequestDto,
} from "./dto/assignment/create.replace.assignment.request.dto";
import { AdminGetAssignmentResponseDto } from "./dto/assignment/get.assignment.response.dto";
import { AdminUpdateAssignmentRequestDto } from "./dto/assignment/update.assignment.request.dto";

interface DashboardFilters {
  startDate?: string;
  endDate?: string;
  assignmentId?: number;
  assignmentName?: string;
  userId?: string;
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  private readonly insightsCache = new Map<
    string,
    { data: any; cachedAt: number }
  >();
  private readonly INSIGHTS_CACHE_TTL = 1 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LLM_PRICING_SERVICE)
    private readonly llmPricingService: LLMPricingService,
  ) {}

  /**
   * Helper method to get cached insights data
   */
  private getCachedInsights(assignmentId: number): any | null {
    const cacheKey = `insights:${assignmentId}`;
    const cached = this.insightsCache.get(cacheKey);

    if (cached && Date.now() - cached.cachedAt < this.INSIGHTS_CACHE_TTL) {
      this.logger.debug(`Cache hit for assignment ${assignmentId} insights`);
      return cached.data;
    }

    if (cached) {
      this.insightsCache.delete(cacheKey);
    }

    return null;
  }

  /**
   * Helper method to cache insights data
   */
  private setCachedInsights(assignmentId: number, data: any): void {
    const cacheKey = `insights:${assignmentId}`;
    this.insightsCache.set(cacheKey, {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data,
      cachedAt: Date.now(),
    });
    this.logger.debug(`Cached insights for assignment ${assignmentId}`);
  }

  /**
   * Helper method to invalidate insights cache for an assignment
   */
  private invalidateInsightsCache(assignmentId: number): void {
    const cacheKey = `insights:${assignmentId}`;
    this.insightsCache.delete(cacheKey);
    this.logger.debug(
      `Invalidated insights cache for assignment ${assignmentId}`,
    );
  }

  /**
   * Public method to invalidate insights cache when assignment data changes
   */
  invalidateAssignmentInsightsCache(assignmentId: number): void {
    this.invalidateInsightsCache(assignmentId);
  }

  async getBasicAssignmentAnalytics(assignmentId: number) {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        questions: {
          where: { isDeleted: false },
        },
      },
    });

    if (!assignment) {
      throw new Error(`Assignment with ID ${assignmentId} not found`);
    }

    const attempts = await this.prisma.assignmentAttempt.findMany({
      where: {
        assignmentId,
        submitted: true,
      },
      include: {
        questionResponses: true,
      },
    });

    const totalGrades = attempts.reduce(
      (sum, attempt) => sum + (attempt.grade || 0),
      0,
    );
    const averageScore =
      attempts.length > 0 ? (totalGrades / attempts.length) * 100 : 0;

    const grades = attempts
      .map((attempt) => attempt.grade || 0)
      .sort((a, b) => a - b);
    const medianIndex = Math.floor(grades.length / 2);
    const medianScore =
      grades.length > 0
        ? (grades.length % 2 === 0
            ? (grades[medianIndex - 1] + grades[medianIndex]) / 2
            : grades[medianIndex]) * 100
        : 0;

    const totalAttempts = attempts.length;
    const completedAttempts = attempts.filter(
      (attempt) => attempt.submitted,
    ).length;
    const completionRate =
      totalAttempts > 0 ? (completedAttempts / totalAttempts) * 100 : 0;

    const completionTimes = attempts
      .map((attempt) => {
        if (attempt.createdAt && attempt.expiresAt) {
          return (
            new Date(attempt.expiresAt).getTime() -
            new Date(attempt.createdAt).getTime()
          );
        }
        return 0;
      })
      .filter((time) => time > 0);

    const avgTimeMs =
      completionTimes.length > 0
        ? completionTimes.reduce((sum, time) => sum + time, 0) /
          completionTimes.length
        : 0;
    const averageCompletionTime = Math.round(avgTimeMs / (1000 * 60));

    const scoreRanges = [
      "0-10",
      "11-20",
      "21-30",
      "31-40",
      "41-50",
      "51-60",
      "61-70",
      "71-80",
      "81-90",
      "91-100",
    ];
    const scoreDistribution = scoreRanges.map((range) => {
      const [min, max] = range.split("-").map(Number);
      const count = grades.filter((grade) => {
        const score = grade * 100;
        return score >= min && score <= max;
      }).length;
      return { range, count };
    });

    const questionBreakdown = assignment.questions.map((question) => {
      const responses = attempts.flatMap((attempt) =>
        attempt.questionResponses.filter(
          (response) => response.questionId === question.id,
        ),
      );

      const totalPoints = responses.reduce(
        (sum, response) => sum + response.points,
        0,
      );
      const averageScore =
        responses.length > 0
          ? (totalPoints / (responses.length * question.totalPoints)) * 100
          : 0;

      const incorrectResponses = responses.filter(
        (response) => response.points < question.totalPoints,
      );
      const incorrectRate =
        responses.length > 0
          ? (incorrectResponses.length / responses.length) * 100
          : 0;

      return {
        questionId: question.id,
        averageScore,
        incorrectRate,
      };
    });

    const uniqueUsers = new Set(attempts.map((attempt) => attempt.userId)).size;

    return {
      averageScore,
      medianScore,
      completionRate,
      totalAttempts,
      averageCompletionTime,
      scoreDistribution,
      questionBreakdown,
      uniqueUsers,
    };
  }

  /**
   * Get assignment attempts with basic information
   */
  private async getAssignmentAttempts(assignmentId: number) {
    try {
      const attempts = await this.prisma.assignmentAttempt.findMany({
        where: { assignmentId },
        select: {
          id: true,
          userId: true,
          submitted: true,
          grade: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      });

      return attempts.map((attempt) => ({
        id: attempt.id,
        userId: attempt.userId,
        submitted: attempt.submitted,
        grade: attempt.grade,
        createdAt: attempt.createdAt.toISOString(),
      }));
    } catch (error) {
      this.logger.error(
        `Error fetching attempts for assignment ${assignmentId}:`,
        error,
      );
      return [];
    }
  }

  /**
   * Precompute insights for popular assignments to improve performance
   */
  async precomputePopularInsights(): Promise<void> {
    try {
      this.logger.log(
        "Starting precomputation of insights for popular assignments",
      );

      const popularAssignments = await this.prisma.assignmentAttempt.groupBy({
        by: ["assignmentId"],
        where: {
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
        },
        _count: {
          assignmentId: true,
        },
        orderBy: {
          _count: {
            assignmentId: "desc",
          },
        },
        take: 20,
      });

      this.logger.log(
        `Found ${popularAssignments.length} popular assignments to precompute`,
      );

      const adminSession = {
        assignmentId: 1,
        role: UserRole.ADMIN,
        groupId: "system-group",
        userId: "system-user",
      };

      const batchSize = 5;
      for (
        let index = 0;
        index < popularAssignments.length;
        index += batchSize
      ) {
        const batch = popularAssignments.slice(index, index + batchSize);

        await Promise.all(
          batch.map(async (assignment) => {
            try {
              await this.getDetailedAssignmentInsights(
                adminSession,
                assignment.assignmentId,
              );
              this.logger.debug(
                `Precomputed insights for assignment ${assignment.assignmentId}`,
              );
            } catch (error) {
              this.logger.warn(
                `Failed to precompute insights for assignment ${assignment.assignmentId}:`,
                error,
              );
            }
          }),
        );

        if (index + batchSize < popularAssignments.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      this.logger.log(
        `Completed precomputation of insights for ${popularAssignments.length} assignments`,
      );
    } catch (error) {
      this.logger.error("Error during insights precomputation:", error);
    }
  }

  /**
   * Helper method to calculate costs using historical pricing data with detailed breakdown
   */
  private async calculateHistoricalCosts(
    aiUsageRecords: Array<{
      tokensIn: number;
      tokensOut: number;
      createdAt: Date;
      usageType?: string;
      modelKey?: string;
    }>,
  ): Promise<{
    totalCost: number;
    costBreakdown: {
      grading: number;
      questionGeneration: number;
      translation: number;
      other: number;
    };
    detailedBreakdown: Array<{
      tokensIn: number;
      tokensOut: number;
      inputCost: number;
      outputCost: number;
      totalCost: number;
      usageDate: Date;
      modelKey: string;
      inputTokenPrice: number;
      outputTokenPrice: number;
      pricingEffectiveDate: Date;
      usageType?: string;
      calculationSteps: {
        inputCalculation: string;
        outputCalculation: string;
        totalCalculation: string;
      };
    }>;
  }> {
    let totalCost = 0;
    const detailedBreakdown = [];
    const costByType = {
      grading: 0,
      questionGeneration: 0,
      translation: 0,
      other: 0,
    };

    for (const usage of aiUsageRecords) {
      let modelKey = usage.modelKey;

      if (!modelKey) {
        this.logger.warn(
          `Missing model key for usage record from ${usage.createdAt.toISOString()}, falling back based on usage type`,
        );

        const usageType = usage.usageType?.toLowerCase() || "";
        if (usageType.includes("translation")) {
          modelKey = "gpt-4o-mini";
        } else if (
          usageType.includes("image") ||
          usageType.includes("vision")
        ) {
          modelKey = "gpt-4.1-mini";
        } else if (
          usageType.includes("grading") ||
          usageType.includes("generation")
        ) {
          modelKey = "gpt-4o";
        } else {
          modelKey = "gpt-4o-mini";
        }
      }

      const costBreakdown =
        await this.llmPricingService.calculateCostWithBreakdown(
          modelKey,
          usage.tokensIn,
          usage.tokensOut,
          usage.createdAt,
          usage.usageType,
        );

      if (costBreakdown) {
        totalCost += costBreakdown.totalCost;

        const usageType = usage.usageType?.toLowerCase() || "other";
        if (usageType.includes("grading")) {
          costByType.grading += costBreakdown.totalCost;
        } else if (
          usageType.includes("question") ||
          usageType.includes("generation")
        ) {
          costByType.questionGeneration += costBreakdown.totalCost;
        } else if (usageType.includes("translation")) {
          costByType.translation += costBreakdown.totalCost;
        } else {
          costByType.other += costBreakdown.totalCost;
        }

        const inputPricePerMillion = costBreakdown.inputTokenPrice * 1_000_000;
        const outputPricePerMillion =
          costBreakdown.outputTokenPrice * 1_000_000;
        const calculationSteps = {
          inputCalculation: `${usage.tokensIn.toLocaleString()} tokens × $${inputPricePerMillion.toFixed(
            2,
          )}/1M tokens = $${costBreakdown.inputCost.toFixed(8)}`,
          outputCalculation: `${usage.tokensOut.toLocaleString()} tokens × $${outputPricePerMillion.toFixed(
            2,
          )}/1M tokens = $${costBreakdown.outputCost.toFixed(8)}`,
          totalCalculation: `$${costBreakdown.inputCost.toFixed(
            8,
          )} + $${costBreakdown.outputCost.toFixed(
            8,
          )} = $${costBreakdown.totalCost.toFixed(8)}`,
        };

        detailedBreakdown.push({
          tokensIn: usage.tokensIn,
          tokensOut: usage.tokensOut,
          inputCost: costBreakdown.inputCost,
          outputCost: costBreakdown.outputCost,
          totalCost: costBreakdown.totalCost,
          usageDate: usage.createdAt,
          modelKey: costBreakdown.modelKey,
          inputTokenPrice: costBreakdown.inputTokenPrice,
          outputTokenPrice: costBreakdown.outputTokenPrice,
          pricingEffectiveDate: costBreakdown.pricingEffectiveDate,
          usageType: usage.usageType,
          calculationSteps,
        });
      } else {
        this.logger.error(
          `No pricing found for ${modelKey} at ${usage.createdAt.toISOString()}, using emergency fallback`,
        );

        const fallbackPrices: Record<
          string,
          { input: number; output: number }
        > = {
          "gpt-4o": { input: 0.000_002_5, output: 0.000_01 },
          "gpt-4o-mini": { input: 0.000_000_15, output: 0.000_000_6 },
          "gpt-4.1-mini": { input: 0.000_002_5, output: 0.000_01 },
        };

        const prices =
          fallbackPrices[modelKey] || fallbackPrices["gpt-4o-mini"];
        const inputCost = usage.tokensIn * prices.input;
        const outputCost = usage.tokensOut * prices.output;
        const fallbackCost = inputCost + outputCost;

        totalCost += fallbackCost;
        costByType.other += fallbackCost;

        const inputPricePerMillion = prices.input * 1_000_000;
        const outputPricePerMillion = prices.output * 1_000_000;
        const calculationSteps = {
          inputCalculation: `${usage.tokensIn.toLocaleString()} tokens × $${inputPricePerMillion.toFixed(
            2,
          )}/1M tokens = $${inputCost.toFixed(8)} (fallback)`,
          outputCalculation: `${usage.tokensOut.toLocaleString()} tokens × $${outputPricePerMillion.toFixed(
            2,
          )}/1M tokens = $${outputCost.toFixed(8)} (fallback)`,
          totalCalculation: `$${inputCost.toFixed(8)} + $${outputCost.toFixed(
            8,
          )} = $${fallbackCost.toFixed(8)} (fallback)`,
        };

        detailedBreakdown.push({
          tokensIn: usage.tokensIn,
          tokensOut: usage.tokensOut,
          inputCost,
          outputCost,
          totalCost: fallbackCost,
          usageDate: usage.createdAt,
          modelKey: `${modelKey} (fallback)`,
          inputTokenPrice: prices.input,
          outputTokenPrice: prices.output,
          pricingEffectiveDate: new Date(),
          usageType: usage.usageType,
          calculationSteps,
        });
      }
    }

    return {
      totalCost,
      costBreakdown: costByType,
      detailedBreakdown,
    };
  }

  /**
   * Helper method to get author activity insights
   */
  private async getAuthorActivity(
    assignmentAuthors: { userId: string; createdAt: Date }[],
  ) {
    if (!assignmentAuthors || assignmentAuthors.length === 0) {
      return {
        totalAuthors: 0,
        authors: [],
        activityInsights: [],
      };
    }

    const authorIds = assignmentAuthors.map(
      (author: { userId: string }) => author.userId,
    );

    const authorAssignments = await this.prisma.assignment.findMany({
      where: {
        AssignmentAuthor: {
          some: {
            userId: {
              in: authorIds,
            },
          },
        },
      },
      include: {
        AssignmentAuthor: true,
        _count: {
          select: {
            questions: true,
            AIUsage: true,
            AssignmentFeedback: true,
          },
        },
      },
    });

    const attemptCounts = await this.prisma.assignmentAttempt.groupBy({
      by: ["assignmentId"],
      where: {
        assignmentId: {
          in: authorAssignments.map((a) => a.id),
        },
      },
      _count: {
        id: true,
      },
    });

    const validAssignmentIds = authorAssignments
      .map((a) => a.id)
      .filter(
        (id) => id !== null && id !== undefined && typeof id === "number",
      );

    const recentActivity =
      validAssignmentIds.length > 0
        ? await this.prisma.assignmentAttempt.findMany({
            where: {
              assignmentId: {
                in: validAssignmentIds,
              },
            },
            select: {
              id: true,
              assignmentId: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
            take: 50,
          })
        : [];

    const authorStats = authorIds.map((authorId) => {
      const authoredAssignments = authorAssignments.filter((assignment) =>
        assignment.AssignmentAuthor.some(
          (author) => author.userId === authorId,
        ),
      );

      const totalAssignments = authoredAssignments.length;
      const totalQuestions = authoredAssignments.reduce(
        (sum, assignment) => sum + assignment._count.questions,
        0,
      );
      const totalAIUsage = authoredAssignments.reduce(
        (sum, assignment) => sum + assignment._count.AIUsage,
        0,
      );
      const totalFeedback = authoredAssignments.reduce(
        (sum, assignment) => sum + assignment._count.AssignmentFeedback,
        0,
      );

      const authorAssignmentIds = new Set(authoredAssignments.map((a) => a.id));
      const totalAttempts = attemptCounts
        .filter((count) => authorAssignmentIds.has(count.assignmentId))
        .reduce((sum, count) => sum + count._count.id, 0);

      const authorRecentActivity = recentActivity.filter((attempt) =>
        authoredAssignments.some(
          (assignment) => assignment.id === attempt.assignmentId,
        ),
      );

      return {
        userId: authorId,
        totalAssignments,
        totalQuestions,
        totalAttempts,
        totalAIUsage,
        totalFeedback,
        averageAttemptsPerAssignment:
          totalAssignments > 0
            ? Math.round(totalAttempts / totalAssignments)
            : 0,
        averageQuestionsPerAssignment:
          totalAssignments > 0
            ? Math.round(totalQuestions / totalAssignments)
            : 0,
        recentActivityCount: authorRecentActivity.length,
        joinedAt:
          assignmentAuthors.find(
            (author: { userId: string; createdAt: Date }) =>
              author.userId === authorId,
          )?.createdAt || new Date(),
        isActiveContributor: totalAssignments >= 3,
        activityScore: Math.round(
          totalAssignments * 2 + totalQuestions * 0.5 + totalAttempts * 0.1,
        ),
      };
    });

    authorStats.sort((a, b) => b.activityScore - a.activityScore);

    const activityInsights = [];
    const totalAuthors = authorStats.length;
    const activeAuthors = authorStats.filter(
      (author) => author.isActiveContributor,
    ).length;
    const mostActiveAuthor = authorStats[0];

    if (totalAuthors > 1) {
      activityInsights.push(
        `This assignment has ${totalAuthors} contributing authors`,
      );

      if (activeAuthors > 0) {
        activityInsights.push(
          `${activeAuthors} of ${totalAuthors} authors are active contributors (3+ assignments)`,
        );
      }

      if (mostActiveAuthor) {
        activityInsights.push(
          `Most active contributor: ${String(mostActiveAuthor.userId)} with ${
            mostActiveAuthor.totalAssignments
          } assignments`,
        );
      }
    } else if (totalAuthors === 1) {
      const singleAuthor = authorStats[0];
      activityInsights.push(
        `Single author assignment by ${String(singleAuthor.userId)}`,
      );
      if (singleAuthor.totalAssignments > 1) {
        activityInsights.push(
          `Author has created ${singleAuthor.totalAssignments} total assignments`,
        );
      }
    }

    return {
      totalAuthors: authorStats.length,
      authors: authorStats,
      activityInsights,
    };
  }

  async cloneAssignment(
    id: number,
    groupId: string,
  ): Promise<BaseAssignmentResponseDto> {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: id },
      include: { questions: true },
    });

    if (!assignment) {
      throw new NotFoundException(`Assignment with Id ${id} not found.`);
    }

    const newAssignmentData = {
      ...assignment,
      id: undefined,
      published: false,
      questions: {
        createMany: {
          data: assignment.questions.map((question) => ({
            ...question,
            id: undefined,
            assignment: undefined,
            assignmentId: undefined,
            scoring: question.scoring ? { set: question.scoring } : undefined,
            choices: question.choices ? { set: question.choices } : undefined,
          })),
        },
      },
      groups: {
        create: [
          {
            group: {
              connectOrCreate: {
                where: {
                  id: groupId,
                },
                create: {
                  id: groupId,
                },
              },
            },
          },
        ],
      },
    };

    const newAssignment = await this.prisma.assignment.create({
      data: newAssignmentData,
      include: { questions: true, groups: true },
    });

    return {
      id: newAssignment.id,
      success: true,
      name: newAssignment.name,
      type: newAssignment.type,
    };
  }

  async getFlaggedSubmissions() {
    return this.prisma.regradingRequest.findMany({
      where: {
        regradingStatus: "PENDING",
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async dismissFlaggedSubmission(id: number) {
    return this.prisma.regradingRequest.update({
      where: { id },
      data: {
        regradingStatus: "REJECTED",
      },
    });
  }

  async getRegradingRequests() {
    return this.prisma.regradingRequest.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async approveRegradingRequest(id: number, newGrade: number) {
    const request = await this.prisma.regradingRequest.findUnique({
      where: { id },
    });

    if (!request) {
      throw new Error(`Regrading request with ID ${id} not found`);
    }

    await this.prisma.regradingRequest.update({
      where: { id },
      data: {
        regradingStatus: "APPROVED",
      },
    });

    await this.prisma.assignmentAttempt.update({
      where: { id: request.attemptId },
      data: {
        grade: newGrade / 100,
      },
    });

    return { success: true };
  }

  async rejectRegradingRequest(id: number, reason: string) {
    const request = await this.prisma.regradingRequest.findUnique({
      where: { id },
    });

    if (!request) {
      throw new Error(`Regrading request with ID ${id} not found`);
    }

    await this.prisma.regradingRequest.update({
      where: { id },
      data: {
        regradingStatus: "REJECTED",
        regradingReason: reason,
      },
    });

    return { success: true };
  }
  async addAssignmentToGroup(
    assignmentId: number,
    groupId: string,
  ): Promise<AdminAddAssignmentToGroupResponseDto> {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
    });

    if (!assignment) {
      throw new NotFoundException(
        `Assignment with Id ${assignmentId} not found.`,
      );
    }

    const assignmentGroup = await this.prisma.assignmentGroup.findFirst({
      where: {
        assignmentId: assignmentId,
        groupId: groupId,
      },
    });

    if (assignmentGroup) {
      return {
        assignmentId: assignmentId,
        groupId: groupId,
        success: true,
      };
    }

    await this.prisma.assignment.update({
      where: { id: assignmentId },
      data: {
        groups: {
          create: [
            {
              group: {
                connectOrCreate: {
                  where: {
                    id: groupId,
                  },
                  create: {
                    id: groupId,
                  },
                },
              },
            },
          ],
        },
      },
    });

    return {
      assignmentId: assignmentId,
      groupId: groupId,
      success: true,
    };
  }

  async createAssignment(
    createAssignmentRequestDto: AdminCreateAssignmentRequestDto,
  ): Promise<BaseAssignmentResponseDto> {
    const assignment = await this.prisma.assignment.create({
      data: {
        name: createAssignmentRequestDto.name,
        type: createAssignmentRequestDto.type,
        published: false,
        groups: {
          create: [
            {
              group: {
                connectOrCreate: {
                  where: {
                    id: createAssignmentRequestDto.groupId,
                  },
                  create: {
                    id: createAssignmentRequestDto.groupId,
                  },
                },
              },
            },
          ],
        },
      },
    });

    return {
      id: assignment.id,
      name: assignment.name,
      type: assignment.type,
      success: true,
    };
  }

  async getAssignment(id: number): Promise<AdminGetAssignmentResponseDto> {
    const result = await this.prisma.assignment.findUnique({
      where: { id },
    });

    if (!result) {
      throw new NotFoundException(`Assignment with Id ${id} not found.`);
    }
    return {
      id: result.id,
      success: true,
      name: result.name,
      type: result.type,
      metadata: result,
    };
  }

  async updateAssignment(
    id: number,
    updateAssignmentDto: AdminUpdateAssignmentRequestDto,
  ): Promise<BaseAssignmentResponseDto> {
    const result = await this.prisma.assignment.update({
      where: { id },
      data: updateAssignmentDto,
    });

    return {
      id: result.id,
      success: true,
      name: result.name,
      type: result.type,
    };
  }

  async replaceAssignment(
    id: number,
    updateAssignmentDto: AdminReplaceAssignmentRequestDto,
  ): Promise<BaseAssignmentResponseDto> {
    const result = await this.prisma.assignment.update({
      where: { id },
      data: updateAssignmentDto,
    });

    return {
      id: result.id,
      success: true,
      name: result.name,
      type: result.type,
    };
  }

  async getAssignmentAnalytics(
    adminSession: UserSession,
    page: number,
    limit: number,
    search?: string,
  ) {
    const isAdmin = adminSession.role === UserRole.ADMIN;
    const skip = (page - 1) * limit;

    const searchCondition = search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            ...(Number.isNaN(Number(search))
              ? []
              : [{ id: { equals: Number(search) } }]),
          ],
        }
      : {};

    const whereClause = {
      ...searchCondition,
      ...(isAdmin
        ? {}
        : {
            AssignmentAuthor: {
              some: {
                userId: adminSession.userId,
              },
            },
          }),
    };

    const totalCount = await this.prisma.assignment.count({
      where: whereClause,
    });

    const assignments = await this.prisma.assignment.findMany({
      where: whereClause,
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        published: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    if (assignments.length === 0) {
      return {
        data: [],
        pagination: {
          total: totalCount,
          page,
          limit,
          totalPages: Math.ceil(totalCount / limit),
        },
      };
    }

    const assignmentIds = assignments.map((a) => a.id);

    const [attemptStats, uniqueLearnersStats, feedbackStats] =
      await Promise.all([
        Promise.all([
          this.prisma.assignmentAttempt.groupBy({
            by: ["assignmentId"],
            where: {
              assignmentId: { in: assignmentIds },
            },
            _count: {
              id: true,
            },
          }),
          this.prisma.assignmentAttempt.groupBy({
            by: ["assignmentId"],
            where: {
              assignmentId: { in: assignmentIds },
              submitted: true,
            },
            _count: {
              id: true,
            },
            _avg: {
              grade: true,
            },
          }),
        ]).then(([totalStats, submittedStats]) => {
          const totalStatsMap = new Map(
            totalStats.map((s) => [s.assignmentId, s._count.id]),
          );
          const submittedStatsMap = new Map(
            submittedStats.map((s) => [s.assignmentId, s]),
          );

          return { totalStatsMap, submittedStatsMap };
        }),

        Promise.all(
          assignmentIds.map(async (assignmentId) => {
            const uniqueUsers = await this.prisma.assignmentAttempt.findMany({
              where: { assignmentId },
              distinct: ["userId"],
              select: { userId: true },
            });
            return { assignmentId, uniqueUsersCount: uniqueUsers.length };
          }),
        ),

        this.prisma.assignmentFeedback.groupBy({
          by: ["assignmentId"],
          where: {
            assignmentId: { in: assignmentIds },
            assignmentRating: { not: undefined },
          },
          _avg: {
            assignmentRating: true,
          },
          _count: {
            id: true,
          },
        }),
      ]);

    const { totalStatsMap, submittedStatsMap } = attemptStats;
    const uniqueLearnersMap = new Map(
      uniqueLearnersStats.map((s) => [s.assignmentId, s.uniqueUsersCount]),
    );
    const feedbackMap = new Map(feedbackStats.map((s) => [s.assignmentId, s]));
    const analyticsData = await Promise.all(
      assignments.map(async (assignment) => {
        const totalAttempts = totalStatsMap.get(assignment.id) || 0;
        const submittedData = submittedStatsMap.get(assignment.id);
        const completedAttempts = submittedData?._count.id || 0;
        const uniqueLearners = uniqueLearnersMap.get(assignment.id) || 0;
        const feedback = feedbackMap.get(assignment.id);
        const averageGrade = (submittedData?._avg.grade || 0) * 100;
        const averageRating = feedback?._avg.assignmentRating || 0;

        const aiUsageDetails = await this.prisma.aIUsage.findMany({
          where: { assignmentId: assignment.id },
          select: {
            tokensIn: true,
            tokensOut: true,
            createdAt: true,
            usageType: true,
            modelKey: true,
          },
        });

        const costData = await this.calculateHistoricalCosts(aiUsageDetails);
        const totalCost = costData.totalCost;

        const performanceInsights: string[] = [];
        if (totalAttempts > 0) {
          const completionRate = (completedAttempts / totalAttempts) * 100;
          if (completionRate < 70) {
            performanceInsights.push(
              `Low completion rate (${Math.round(
                completionRate,
              )}%) - consider reducing difficulty`,
            );
          }
          if (averageGrade > 85) {
            performanceInsights.push(
              `High average grade (${Math.round(
                averageGrade,
              )}%) - learners are doing well`,
            );
          } else if (averageGrade < 60) {
            performanceInsights.push(
              `Low average grade (${Math.round(
                averageGrade,
              )}%) - may need clearer instructions`,
            );
          }
        }

        const costBreakdown = {
          grading: Math.round(costData.costBreakdown.grading * 100) / 100,
          questionGeneration:
            Math.round(costData.costBreakdown.questionGeneration * 100) / 100,
          translation:
            Math.round(costData.costBreakdown.translation * 100) / 100,
          other: Math.round(costData.costBreakdown.other * 100) / 100,
        };

        return {
          id: assignment.id,
          name: assignment.name,
          totalCost,
          uniqueLearners,
          totalAttempts,
          completedAttempts,
          averageGrade,
          averageRating,
          published: assignment.published,
          insights: {
            questionInsights: [],
            performanceInsights,
            costBreakdown,
            detailedCostBreakdown: costData.detailedBreakdown.map((detail) => ({
              ...detail,
              usageDate: detail.usageDate.toISOString(),
              pricingEffectiveDate: detail.pricingEffectiveDate.toISOString(),
            })),
          },
        };
      }),
    );

    return {
      data: analyticsData,
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit),
      },
    };
  }

  async getDashboardStats(
    adminSession: UserSession & { userId?: string },
    filters?: DashboardFilters,
  ) {
    const isAdmin = adminSession.role === UserRole.ADMIN;

    const assignmentWhere: any = isAdmin
      ? {}
      : {
          AssignmentAuthor: {
            some: {
              userId: adminSession.userId,
            },
          },
        };

    if (filters?.assignmentId) {
      assignmentWhere.id = filters.assignmentId;
    }
    if (filters?.assignmentName) {
      assignmentWhere.name = {
        contains: filters.assignmentName,
        mode: "insensitive",
      };
    }

    const dateFilter: any = {};
    if (filters?.startDate || filters?.endDate) {
      if (filters.startDate) {
        dateFilter.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        dateFilter.lte = new Date(filters.endDate);
      }
    }

    let assignmentIds: number[] = [];
    if (!isAdmin) {
      const assignments = await this.prisma.assignment.findMany({
        where: assignmentWhere,
        select: { id: true },
      });
      assignmentIds = assignments.map((a) => a.id);
    } else if (filters?.assignmentId || filters?.assignmentName) {
      const assignments = await this.prisma.assignment.findMany({
        where: assignmentWhere,
        select: { id: true },
      });
      assignmentIds = assignments.map((a) => a.id);
    }

    const [
      totalAssignments,
      publishedAssignments,
      attemptStats,
      feedbackCount,
      reportCounts,
      recentAttempts,
      learnerCount,
      aiUsageStats,
      averageAssignmentRating,
    ] = await Promise.all([
      this.prisma.assignment.count({ where: assignmentWhere }),

      this.prisma.assignment.count({
        where: { ...assignmentWhere, published: true },
      }),

      isAdmin || assignmentIds.length > 0
        ? this.prisma.assignmentAttempt
            .aggregate({
              where: {
                ...(isAdmin ? {} : { assignmentId: { in: assignmentIds } }),
                ...(assignmentIds.length > 0 && isAdmin
                  ? { assignmentId: { in: assignmentIds } }
                  : {}),
                ...(Object.keys(dateFilter).length > 0
                  ? { createdAt: dateFilter }
                  : {}),
                ...(filters?.userId
                  ? {
                      userId: { contains: filters.userId, mode: "insensitive" },
                    }
                  : {}),
              },
              _count: { id: true },
            })
            .then(async (totalAttempts) => {
              const uniqueUsers = await this.prisma.assignmentAttempt.groupBy({
                by: ["userId"],
                where: {
                  ...(isAdmin ? {} : { assignmentId: { in: assignmentIds } }),
                  ...(assignmentIds.length > 0 && isAdmin
                    ? { assignmentId: { in: assignmentIds } }
                    : {}),
                  ...(Object.keys(dateFilter).length > 0
                    ? { createdAt: dateFilter }
                    : {}),
                  ...(filters?.userId
                    ? {
                        userId: {
                          contains: filters.userId,
                          mode: "insensitive",
                        },
                      }
                    : {}),
                },
              });
              return {
                totalAttempts: totalAttempts._count.id,
                totalUsers: uniqueUsers.length,
              };
            })
        : Promise.resolve({ totalAttempts: 0, totalUsers: 0 }),

      isAdmin || assignmentIds.length > 0
        ? this.prisma.assignmentFeedback.count({
            where: {
              ...(isAdmin ? {} : { assignmentId: { in: assignmentIds } }),
              ...(assignmentIds.length > 0 && isAdmin
                ? { assignmentId: { in: assignmentIds } }
                : {}),
              ...(Object.keys(dateFilter).length > 0
                ? { createdAt: dateFilter }
                : {}),
              ...(filters?.userId
                ? { userId: { contains: filters.userId, mode: "insensitive" } }
                : {}),
            },
          })
        : 0,

      isAdmin
        ? this.prisma.report
            .aggregate({
              _count: { id: true },
              where: {
                ...(Object.keys(dateFilter).length > 0
                  ? { createdAt: dateFilter }
                  : {}),
                ...(filters?.userId
                  ? {
                      userId: { contains: filters.userId, mode: "insensitive" },
                    }
                  : {}),
              },
            })
            .then(async (total) => {
              const open = await this.prisma.report.count({
                where: {
                  status: "OPEN",
                  ...(Object.keys(dateFilter).length > 0
                    ? { createdAt: dateFilter }
                    : {}),
                  ...(filters?.userId
                    ? {
                        userId: {
                          contains: filters.userId,
                          mode: "insensitive",
                        },
                      }
                    : {}),
                },
              });
              return { totalReports: total._count.id, openReports: open };
            })
        : { totalReports: 0, openReports: 0 },

      isAdmin || assignmentIds.length > 0
        ? this.prisma.assignmentAttempt.findMany({
            where: {
              ...(isAdmin ? {} : { assignmentId: { in: assignmentIds } }),
              ...(assignmentIds.length > 0 && isAdmin
                ? { assignmentId: { in: assignmentIds } }
                : {}),
              ...(Object.keys(dateFilter).length > 0
                ? { createdAt: dateFilter }
                : {}),
              ...(filters?.userId
                ? { userId: { contains: filters.userId, mode: "insensitive" } }
                : {}),
            },
            take: 10,
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              userId: true,
              submitted: true,
              grade: true,
              createdAt: true,
              assignmentId: true,
            },
          })
        : [],

      isAdmin || assignmentIds.length > 0
        ? this.prisma.assignmentAttempt
            .groupBy({
              by: ["userId"],
              where: {
                ...(isAdmin ? {} : { assignmentId: { in: assignmentIds } }),
                ...(assignmentIds.length > 0 && isAdmin
                  ? { assignmentId: { in: assignmentIds } }
                  : {}),
                ...(Object.keys(dateFilter).length > 0
                  ? { createdAt: dateFilter }
                  : {}),
                ...(filters?.userId
                  ? {
                      userId: { contains: filters.userId, mode: "insensitive" },
                    }
                  : {}),
              },
            })
            .then((users) => users.length)
        : 0,

      isAdmin || assignmentIds.length > 0
        ? this.prisma.aIUsage.findMany({
            where: {
              ...(isAdmin
                ? {}
                : {
                    assignment: {
                      AssignmentAuthor: {
                        some: { userId: adminSession.userId },
                      },
                    },
                  }),
              ...(assignmentIds.length > 0 && isAdmin
                ? { assignmentId: { in: assignmentIds } }
                : {}),
              ...(Object.keys(dateFilter).length > 0
                ? { createdAt: dateFilter }
                : {}),
            },
            select: {
              tokensIn: true,
              tokensOut: true,
              createdAt: true,
              usageType: true,
              modelKey: true,
            },
          })
        : [],

      isAdmin || assignmentIds.length > 0
        ? this.prisma.assignmentFeedback.aggregate({
            where: {
              ...(isAdmin ? {} : { assignmentId: { in: assignmentIds } }),
              ...(assignmentIds.length > 0 && isAdmin
                ? { assignmentId: { in: assignmentIds } }
                : {}),
              ...(Object.keys(dateFilter).length > 0
                ? { createdAt: dateFilter }
                : {}),
              ...(filters?.userId
                ? { userId: { contains: filters.userId, mode: "insensitive" } }
                : {}),
            },
            _avg: { assignmentRating: true },
          })
        : { _avg: { assignmentRating: 0 } },
    ]);

    const costData = await this.calculateHistoricalCosts(aiUsageStats);
    const totalCost = costData.totalCost;

    const assignmentNames = new Map<number, string>();
    if (recentAttempts.length > 0) {
      const uniqueAssignmentIds = [
        ...new Set(recentAttempts.map((a: any) => a.assignmentId)),
      ];
      const assignments = await this.prisma.assignment.findMany({
        where: { id: { in: uniqueAssignmentIds } },
        select: { id: true, name: true },
      });
      for (const assignment of assignments) {
        assignmentNames.set(assignment.id, assignment.name);
      }
    }

    return {
      totalAssignments,
      publishedAssignments,
      totalReports: reportCounts.totalReports,
      openReports: reportCounts.openReports,
      totalFeedback: feedbackCount,
      totalLearners: learnerCount,
      totalAttempts: attemptStats.totalAttempts,
      totalUsers: attemptStats.totalUsers,
      averageAssignmentRating:
        averageAssignmentRating._avg.assignmentRating || 0,
      totalCost: Math.round(totalCost * 100) / 100,
      costBreakdown: {
        grading: Math.round(costData.costBreakdown.grading * 100) / 100,
        questionGeneration:
          Math.round(costData.costBreakdown.questionGeneration * 100) / 100,
        translation: Math.round(costData.costBreakdown.translation * 100) / 100,
        other: Math.round(costData.costBreakdown.other * 100) / 100,
      },
      userRole: isAdmin ? ("admin" as const) : ("author" as const),
      recentActivity: recentAttempts.map((attempt: any) => ({
        id: attempt.id,
        assignmentName: assignmentNames.get(attempt.assignmentId) ?? "Unknown",
        userId: attempt.userId,
        submitted: attempt.submitted,
        grade: attempt.grade,
        createdAt: attempt.createdAt,
      })),
    };
  }

  async getDetailedAssignmentInsights(
    adminSession: UserSession,
    assignmentId: number,
  ) {
    try {
      const cachedInsights = this.getCachedInsights(assignmentId);
      if (cachedInsights) {
        return cachedInsights;
      }
      if (!assignmentId || assignmentId <= 0) {
        throw new Error(`Invalid assignment ID: ${assignmentId}`);
      }

      const isAdmin = adminSession.role === UserRole.ADMIN;

      const assignment = await this.prisma.assignment.findFirst({
        where: {
          id: assignmentId,
          ...(isAdmin
            ? {}
            : {
                AssignmentAuthor: {
                  some: {
                    userId: adminSession.userId,
                  },
                },
              }),
        },
        include: {
          questions: {
            where: { isDeleted: false },
            include: {
              translations: true,
              variants: {
                where: { isDeleted: false },
              },
            },
          },
          AIUsage: true,
          AssignmentFeedback: true,
          Report: true,
          AssignmentAuthor: true,
        },
      });

      if (!assignment) {
        throw new NotFoundException(
          `Assignment with ID ${assignmentId} not found or access denied`,
        );
      }

      let totalAttempts = 0;
      let submittedAttempts = 0;
      let calculatedAverageGrade = 0;

      try {
        totalAttempts = await this.prisma.assignmentAttempt.count({
          where: { assignmentId },
        });

        submittedAttempts = await this.prisma.assignmentAttempt.count({
          where: { assignmentId, submitted: true },
        });

        const gradeAvg = await this.prisma.assignmentAttempt.aggregate({
          where: { assignmentId, submitted: true },
          _avg: { grade: true },
        });
        calculatedAverageGrade = (gradeAvg._avg.grade || 0) * 100;
      } catch (error) {
        this.logger.error(
          `Error fetching attempt statistics for assignment ${assignmentId}:`,
          error,
        );
      }

      const questionInsights = [];
      const batchSize = 3;

      for (
        let index = 0;
        index < assignment.questions.length;
        index += batchSize
      ) {
        const batch = assignment.questions.slice(index, index + batchSize);

        try {
          const batchResults = await Promise.all(
            batch.map(async (question) => {
              let totalResponses = 0;
              let correctCount = 0;
              let averagePoints = 0;

              try {
                totalResponses = await this.prisma.questionResponse.count({
                  where: {
                    questionId: question.id,
                    assignmentAttempt: { assignmentId },
                  },
                });

                if (totalResponses > 0) {
                  correctCount = await this.prisma.questionResponse.count({
                    where: {
                      questionId: question.id,
                      assignmentAttempt: { assignmentId },
                      points: question.totalPoints,
                    },
                  });

                  const pointsAvg =
                    await this.prisma.questionResponse.aggregate({
                      where: {
                        questionId: question.id,
                        assignmentAttempt: { assignmentId },
                      },
                      _avg: { points: true },
                    });
                  averagePoints = pointsAvg._avg.points || 0;
                }
              } catch (error) {
                this.logger.error(
                  `Error fetching response statistics for question ${question.id}:`,
                  error,
                );
              }

              const correctPercentage =
                totalResponses > 0 ? (correctCount / totalResponses) * 100 : 0;

              let insight = `${Math.round(
                correctPercentage,
              )}% of learners answered correctly`;
              if (correctPercentage < 50) {
                insight += ` - consider reviewing this question`;
              }

              return {
                id: question.id,
                question: question.question,
                type: question.type,
                totalPoints: question.totalPoints,
                correctPercentage,
                averagePoints,
                responseCount: totalResponses,
                insight,
                variants: question.variants.length,
                translations: question.translations.map((t) => ({
                  languageCode: t.languageCode,
                })),
              };
            }),
          );
          questionInsights.push(...batchResults);

          if (index + batchSize < assignment.questions.length) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        } catch (error) {
          this.logger.error(
            `Error processing question batch starting at index ${index}:`,
            error,
          );
          const fallbackResults = batch.map((question) => ({
            id: question.id,
            question: question.question,
            type: question.type,
            totalPoints: question.totalPoints,
            correctPercentage: 0,
            averagePoints: 0,
            responseCount: 0,
            insight: "Data unavailable due to processing error",
            variants: question.variants?.length || 0,
            translations:
              question.translations?.map((t) => ({
                languageCode: t.languageCode,
              })) || [],
          }));
          questionInsights.push(...fallbackResults);
        }
      }

      const uniqueLearners = await this.prisma.assignmentAttempt.groupBy({
        by: ["userId"],
        where: { assignmentId },
      });

      const completedAttempts = submittedAttempts;
      const averageGrade = calculatedAverageGrade;

      const aiUsageRecords = assignment.AIUsage.map((usage) => ({
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        createdAt: usage.createdAt,
        usageType: usage.usageType,
        modelKey: usage.modelKey,
      }));

      const costData = await this.calculateHistoricalCosts(aiUsageRecords);
      const totalCost = costData.totalCost;

      const authorActivity = await this.getAuthorActivity(
        assignment.AssignmentAuthor,
      );

      const aiUsageWithCost = assignment.AIUsage.map((usage, index) => {
        const detailedCost = costData.detailedBreakdown[index] || {
          totalCost: 0,
          inputCost: 0,
          outputCost: 0,
          modelKey: "unknown",
          inputTokenPrice: 0,
          outputTokenPrice: 0,
          pricingEffectiveDate: new Date(),
          calculationSteps: {
            inputCalculation: "0 tokens × $0 = $0 (missing)",
            outputCalculation: "0 tokens × $0 = $0 (missing)",
            totalCalculation: "$0 + $0 = $0 (missing)",
          },
        };

        return {
          usageType: usage.usageType,
          tokensIn: usage.tokensIn,
          tokensOut: usage.tokensOut,
          usageCount: usage.usageCount,
          inputCost: detailedCost.inputCost,
          outputCost: detailedCost.outputCost,
          totalCost: detailedCost.totalCost,
          modelUsed: detailedCost.modelKey,
          inputTokenPrice: detailedCost.inputTokenPrice,
          outputTokenPrice: detailedCost.outputTokenPrice,
          pricingEffectiveDate: detailedCost.pricingEffectiveDate.toISOString(),
          calculationSteps: detailedCost.calculationSteps,
          createdAt: usage.createdAt.toISOString(),
        };
      });

      const ratings = assignment.AssignmentFeedback.map(
        (f) => f.assignmentRating,
      ).filter((r) => r !== null);
      const averageRating =
        ratings.length > 0
          ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length
          : 0;

      const totalPoints = assignment.questions.reduce(
        (sum, q) => sum + q.totalPoints,
        0,
      );

      const costBreakdown = {
        grading: Math.round(costData.costBreakdown.grading * 100) / 100,
        questionGeneration:
          Math.round(costData.costBreakdown.questionGeneration * 100) / 100,
        translation: Math.round(costData.costBreakdown.translation * 100) / 100,
        other: Math.round(costData.costBreakdown.other * 100) / 100,
      };

      const performanceInsights: string[] = [];
      if (completedAttempts > 0 && totalAttempts > 0) {
        const completionRate = (completedAttempts / totalAttempts) * 100;
        if (completionRate < 70) {
          performanceInsights.push(
            `Low completion rate (${Math.round(
              completionRate,
            )}%) - consider reducing difficulty`,
          );
        }
        if (averageGrade > 85) {
          performanceInsights.push(
            `High average grade (${Math.round(
              averageGrade,
            )}%) - learners are doing well`,
          );
        }
        if (averageGrade < 60) {
          performanceInsights.push(
            `Low average grade (${Math.round(
              averageGrade,
            )}%) - may need clearer instructions`,
          );
        }
      }

      const insights = {
        assignment: {
          id: assignment.id,
          name: assignment.name,
          type: assignment.type,
          published: assignment.published,
          introduction: assignment.introduction,
          instructions: assignment.instructions,
          timeEstimateMinutes: assignment.timeEstimateMinutes,
          allotedTimeMinutes: assignment.allotedTimeMinutes,
          passingGrade: assignment.passingGrade,
          createdAt: assignment.updatedAt.toISOString(),
          updatedAt: assignment.updatedAt.toISOString(),
          totalPoints,
        },
        analytics: {
          totalCost,
          uniqueLearners: uniqueLearners.length,
          totalAttempts,
          completedAttempts,
          averageGrade,
          averageRating,
          costBreakdown,
          performanceInsights,
        },
        questions: questionInsights,
        attempts: await this.getAssignmentAttempts(assignmentId),
        feedback: assignment.AssignmentFeedback.map((feedback) => ({
          id: feedback.id,
          userId: feedback.userId,
          assignmentRating: feedback.assignmentRating,
          aiGradingRating: feedback.aiGradingRating,
          aiFeedbackRating: feedback.aiFeedbackRating,
          comments: feedback.comments,
          createdAt: feedback.createdAt.toISOString(),
        })),
        reports: assignment.Report.map((report) => ({
          id: report.id,
          issueType: report.issueType,
          description: report.description,
          status: report.status,
          createdAt: report.createdAt.toISOString(),
        })),
        aiUsage: aiUsageWithCost,
        costCalculationDetails: {
          totalCost: Math.round(totalCost * 100) / 100,
          breakdown: costData.detailedBreakdown.map((detail) => ({
            usageType: detail.usageType || "Unknown",
            tokensIn: detail.tokensIn,
            tokensOut: detail.tokensOut,
            modelUsed: detail.modelKey,
            inputTokenPrice: detail.inputTokenPrice,
            outputTokenPrice: detail.outputTokenPrice,
            inputCost: Math.round(detail.inputCost * 100_000_000) / 100_000_000,
            outputCost:
              Math.round(detail.outputCost * 100_000_000) / 100_000_000,
            totalCost: Math.round(detail.totalCost * 100_000_000) / 100_000_000,
            pricingEffectiveDate: detail.pricingEffectiveDate.toISOString(),
            usageDate: detail.usageDate.toISOString(),
            calculationSteps: detail.calculationSteps,
          })),
          summary: {
            totalInputTokens: costData.detailedBreakdown.reduce(
              (sum, d) => sum + d.tokensIn,
              0,
            ),
            totalOutputTokens: costData.detailedBreakdown.reduce(
              (sum, d) => sum + d.tokensOut,
              0,
            ),
            totalInputCost:
              Math.round(
                costData.detailedBreakdown.reduce(
                  (sum, d) => sum + d.inputCost,
                  0,
                ) * 100_000_000,
              ) / 100_000_000,
            totalOutputCost:
              Math.round(
                costData.detailedBreakdown.reduce(
                  (sum, d) => sum + d.outputCost,
                  0,
                ) * 100_000_000,
              ) / 100_000_000,
            averageInputPrice:
              costData.detailedBreakdown.length > 0
                ? costData.detailedBreakdown.reduce(
                    (sum, d) => sum + d.inputTokenPrice,
                    0,
                  ) / costData.detailedBreakdown.length
                : 0,
            averageOutputPrice:
              costData.detailedBreakdown.length > 0
                ? costData.detailedBreakdown.reduce(
                    (sum, d) => sum + d.outputTokenPrice,
                    0,
                  ) / costData.detailedBreakdown.length
                : 0,
            // eslint-disable-next-line unicorn/no-array-reduce
            modelDistribution: costData.detailedBreakdown.reduce(
              (accumulator: Record<string, number>, detail) => {
                accumulator[detail.modelKey] =
                  (accumulator[detail.modelKey] || 0) + detail.totalCost;
                return accumulator;
              },
              {} as Record<string, number>,
            ),
            usageTypeDistribution: {
              grading: Math.round(costData.costBreakdown.grading * 100) / 100,
              questionGeneration:
                Math.round(costData.costBreakdown.questionGeneration * 100) /
                100,
              translation:
                Math.round(costData.costBreakdown.translation * 100) / 100,
              other: Math.round(costData.costBreakdown.other * 100) / 100,
            },
          },
        },
        authorActivity: {
          totalAuthors: authorActivity.totalAuthors,
          authors: authorActivity.authors,
          activityInsights: authorActivity.activityInsights,
        },
      };

      this.setCachedInsights(assignmentId, insights);

      return insights;
    } catch (error) {
      this.logger.error(
        `Error getting detailed assignment insights for assignment ${assignmentId}:`,
        error,
      );

      return {
        insights: {
          questionInsights: [],
          performanceInsights: [
            "Unable to load detailed insights due to a data processing error. Please try again later.",
          ],
          costBreakdown: {
            grading: 0,
            questionGeneration: 0,
            translation: 0,
            other: 0,
          },
        },
        authorActivity: {
          totalAuthors: 0,
          authors: [],
          activityInsights: ["Author activity data is currently unavailable."],
        },
      };
    }
  }

  async removeAssignment(id: number): Promise<BaseAssignmentResponseDto> {
    await this.prisma.questionResponse.deleteMany({
      where: { assignmentAttempt: { assignmentId: id } },
    });

    await this.prisma.assignmentAttemptQuestionVariant.deleteMany({
      where: { assignmentAttempt: { assignmentId: id } },
    });

    await this.prisma.assignmentAttempt.deleteMany({
      where: { assignmentId: id },
    });

    await this.prisma.assignmentGroup.deleteMany({
      where: { assignmentId: id },
    });

    await this.prisma.assignmentFeedback.deleteMany({
      where: { assignmentId: id },
    });

    await this.prisma.regradingRequest.deleteMany({
      where: { assignmentId: id },
    });

    await this.prisma.report.deleteMany({
      where: { assignmentId: id },
    });

    await this.prisma.assignmentTranslation.deleteMany({
      where: { assignmentId: id },
    });

    await this.prisma.aIUsage.deleteMany({
      where: { assignmentId: id },
    });

    await this.prisma.question.deleteMany({
      where: { assignmentId: id },
    });

    const assignmentExists = await this.prisma.assignment.findUnique({
      where: { id },
      select: { id: true, name: true, type: true },
    });

    if (!assignmentExists) {
      throw new NotFoundException(`Assignment with Id ${id} not found.`);
    }

    await this.prisma.assignment.delete({
      where: { id },
    });

    return {
      id: id,
      success: true,
      name: assignmentExists.name || "",
      type: assignmentExists.type || "AI_GRADED",
    };
  }

  async executeQuickAction(
    adminSession: { email: string; role: UserRole; userId?: string },
    action: string,
    limit = 10,
  ) {
    const isAdmin = adminSession.role === UserRole.ADMIN;

    const assignmentWhere: any = isAdmin
      ? {}
      : {
          AssignmentAuthor: {
            some: {
              userId: adminSession.userId,
            },
          },
        };

    switch (action) {
      case "top-assignments-by-cost": {
        return await this.getTopAssignmentsByCost(assignmentWhere, limit);
      }

      case "top-assignments-by-attempts": {
        return await this.getTopAssignmentsByAttempts(assignmentWhere, limit);
      }

      case "top-assignments-by-learners": {
        return await this.getTopAssignmentsByLearners(assignmentWhere, limit);
      }

      case "most-expensive-assignments": {
        return await this.getMostExpensiveAssignments(assignmentWhere, limit);
      }

      case "assignments-with-most-reports": {
        return await this.getAssignmentsWithMostReports(assignmentWhere, limit);
      }

      case "highest-rated-assignments": {
        return await this.getHighestRatedAssignments(assignmentWhere, limit);
      }

      case "assignments-with-lowest-ratings": {
        return await this.getAssignmentsWithLowestRatings(
          assignmentWhere,
          limit,
        );
      }

      case "recent-high-activity": {
        return await this.getRecentHighActivityAssignments(
          assignmentWhere,
          limit,
        );
      }

      case "cost-per-learner-analysis": {
        return await this.getCostPerLearnerAnalysis(assignmentWhere, limit);
      }

      case "completion-rate-analysis": {
        return await this.getCompletionRateAnalysis(assignmentWhere, limit);
      }

      default: {
        throw new Error(`Unknown quick action: ${action}`);
      }
    }
  }

  private async getTopAssignmentsByCost(assignmentWhere: any, limit: number) {
    const assignments = await this.prisma.assignment.findMany({
      where: assignmentWhere,
      select: {
        id: true,
        name: true,
        published: true,
        updatedAt: true,
        AIUsage: {
          select: {
            tokensIn: true,
            tokensOut: true,
            createdAt: true,
            usageType: true,
            modelKey: true,
          },
        },
        AssignmentFeedback: {
          select: { id: true },
        },
      },
      take: Math.min(limit * 10, 1000),
    });

    const assignmentsWithCost = await Promise.all(
      assignments.map(async (assignment) => {
        const costData = await this.calculateHistoricalCosts(
          assignment.AIUsage,
        );

        const attemptCount = await this.prisma.assignmentAttempt.count({
          where: { assignmentId: assignment.id },
        });

        return {
          id: assignment.id,
          name: assignment.name,
          totalCost: costData.totalCost,
          costBreakdown: costData.costBreakdown,
          attempts: attemptCount,
          feedback: assignment.AssignmentFeedback.length,
          published: assignment.published,
          createdAt: assignment.updatedAt,
        };
      }),
    );

    return {
      title: `Top ${limit} Assignments by AI Cost`,
      data: assignmentsWithCost
        .sort((a, b) => b.totalCost - a.totalCost)
        .slice(0, limit),
    };
  }

  private async getTopAssignmentsByAttempts(
    assignmentWhere: any,
    limit: number,
  ) {
    const assignments = await this.prisma.assignment.findMany({
      where: assignmentWhere,
      select: {
        id: true,
        name: true,
        published: true,
        updatedAt: true,
        AssignmentFeedback: { select: { id: true } },
      },
      take: Math.min(limit * 10, 1000),
    });

    const assignmentsWithAttempts = await Promise.all(
      assignments.map(async (assignment) => {
        const attempts = await this.prisma.assignmentAttempt.findMany({
          where: { assignmentId: assignment.id },
          select: {
            userId: true,
            submitted: true,
            grade: true,
          },
        });

        const submittedAttempts = attempts.filter((a) => a.submitted).length;
        const averageGrade =
          attempts.length > 0
            ? attempts.reduce((sum, a) => sum + (a.grade || 0), 0) /
              attempts.length
            : 0;

        return {
          id: assignment.id,
          name: assignment.name,
          totalAttempts: attempts.length,
          submittedAttempts,
          uniqueUsers: new Set(attempts.map((a) => a.userId)).size,
          averageGrade: averageGrade,
          feedback: assignment.AssignmentFeedback.length,
          published: assignment.published,
          createdAt: assignment.updatedAt,
        };
      }),
    );

    return {
      title: `Top ${limit} Assignments by Attempts`,
      data: assignmentsWithAttempts
        .sort((a, b) => b.totalAttempts - a.totalAttempts)
        .slice(0, limit),
    };
  }

  private async getTopAssignmentsByLearners(
    assignmentWhere: any,
    limit: number,
  ) {
    const assignments = await this.prisma.assignment.findMany({
      where: assignmentWhere,
      select: {
        id: true,
        name: true,
        published: true,
        updatedAt: true,
        AssignmentFeedback: { select: { id: true } },
      },
      take: Math.min(limit * 10, 1000),
    });

    const assignmentsWithLearnerCount = await Promise.all(
      assignments.map(async (assignment) => {
        const attempts = await this.prisma.assignmentAttempt.findMany({
          where: { assignmentId: assignment.id },
          select: {
            userId: true,
            submitted: true,
          },
        });

        const uniqueLearners = new Set(attempts.map((a) => a.userId)).size;
        const completedLearners = new Set(
          attempts.filter((a) => a.submitted).map((a) => a.userId),
        ).size;

        return {
          id: assignment.id,
          name: assignment.name,
          uniqueLearners,
          completedLearners,
          totalAttempts: attempts.length,
          completionRate:
            uniqueLearners > 0 ? (completedLearners / uniqueLearners) * 100 : 0,
          feedback: assignment.AssignmentFeedback.length,
          published: assignment.published,
          createdAt: assignment.updatedAt,
        };
      }),
    );

    return {
      title: `Top ${limit} Assignments by Unique Learners`,
      data: assignmentsWithLearnerCount
        .sort((a, b) => b.uniqueLearners - a.uniqueLearners)
        .slice(0, limit),
    };
  }

  private async getMostExpensiveAssignments(
    assignmentWhere: any,
    limit: number,
  ) {
    return await this.getTopAssignmentsByCost(assignmentWhere, limit);
  }

  private async getAssignmentsWithMostReports(
    assignmentWhere: any,
    limit: number,
  ) {
    const assignments = await this.prisma.assignment.findMany({
      where: assignmentWhere,
      select: {
        id: true,
        name: true,
        published: true,
        updatedAt: true,
        Report: {
          select: {
            status: true,
            issueType: true,
            createdAt: true,
          },
        },
        AssignmentFeedback: { select: { id: true } },
      },
      take: Math.min(limit * 10, 1000),
    });

    const assignmentsWithReports = await Promise.all(
      assignments.map(async (assignment) => {
        const attemptCount = await this.prisma.assignmentAttempt.count({
          where: { assignmentId: assignment.id },
        });

        const openReports = assignment.Report.filter(
          (r: any) => r.status === "OPEN",
        ).length;
        const recentReports = assignment.Report.filter(
          (r: any) =>
            new Date(r.createdAt) >
            new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        ).length;

        return {
          id: assignment.id,
          name: assignment.name,
          totalReports: assignment.Report.length,
          openReports,
          recentReports,
          attempts: attemptCount,
          feedback: assignment.AssignmentFeedback.length,
          published: assignment.published,
          createdAt: assignment.updatedAt,
        };
      }),
    );

    return {
      title: `Top ${limit} Assignments with Most Reports`,
      data: assignmentsWithReports
        .sort((a, b) => b.totalReports - a.totalReports)
        .slice(0, limit),
    };
  }

  private async getHighestRatedAssignments(
    assignmentWhere: any,
    limit: number,
  ) {
    const assignments = await this.prisma.assignment.findMany({
      where: assignmentWhere,
      select: {
        id: true,
        name: true,
        published: true,
        updatedAt: true,
        AssignmentFeedback: {
          select: {
            assignmentRating: true,
            aiGradingRating: true,
            createdAt: true,
          },
        },
      },
      take: Math.min(limit * 10, 1000),
    });

    const assignmentsWithRatings = await Promise.all(
      assignments.map(async (assignment) => {
        const attemptCount = await this.prisma.assignmentAttempt.count({
          where: { assignmentId: assignment.id },
        });

        const ratings = assignment.AssignmentFeedback.map(
          (f: any) => f.assignmentRating,
        ).filter((r: any) => r !== null && r !== undefined) as number[];

        const averageRating =
          ratings.length > 0
            ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
            : 0;

        const aiRatings = assignment.AssignmentFeedback.map(
          (f: any) => f.aiGradingRating,
        ).filter((r: any) => r !== null && r !== undefined) as number[];

        const averageAiRating =
          aiRatings.length > 0
            ? aiRatings.reduce((sum, rating) => sum + rating, 0) /
              aiRatings.length
            : 0;

        return {
          id: assignment.id,
          name: assignment.name,
          averageRating,
          averageAiRating,
          totalRatings: ratings.length,
          attempts: attemptCount,
          feedback: assignment.AssignmentFeedback.length,
          published: assignment.published,
          createdAt: assignment.updatedAt,
        };
      }),
    );

    return {
      title: `Top ${limit} Highest Rated Assignments`,
      data: assignmentsWithRatings
        .filter((a) => a.totalRatings > 0)
        .sort((a, b) => b.averageRating - a.averageRating)
        .slice(0, limit),
    };
  }

  private async getAssignmentsWithLowestRatings(
    assignmentWhere: any,
    limit: number,
  ) {
    const result = await this.getHighestRatedAssignments(
      assignmentWhere,
      limit * 2,
    );
    return {
      title: `${limit} Assignments with Lowest Ratings`,
      data: result.data
        .sort((a, b) => a.averageRating - b.averageRating)
        .slice(0, limit),
    };
  }

  private async getRecentHighActivityAssignments(
    assignmentWhere: any,
    limit: number,
  ) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const assignmentIds = await this.prisma.assignmentAttempt.findMany({
      where: {
        createdAt: { gte: sevenDaysAgo },
      },
      select: { assignmentId: true },
      distinct: ["assignmentId"],
    });

    const assignments = await this.prisma.assignment.findMany({
      where: {
        ...assignmentWhere,
        id: { in: assignmentIds.map((a) => a.assignmentId) },
      },
      select: {
        id: true,
        name: true,
        published: true,
        updatedAt: true,
        AssignmentFeedback: { select: { id: true } },
      },
      take: Math.min(limit * 10, 1000),
    });

    const assignmentsWithActivity = await Promise.all(
      assignments.map(async (assignment) => {
        const recentAttempts = await this.prisma.assignmentAttempt.findMany({
          where: {
            assignmentId: assignment.id,
            createdAt: { gte: sevenDaysAgo },
          },
          select: {
            userId: true,
            submitted: true,
            createdAt: true,
          },
        });

        const totalAttempts = await this.prisma.assignmentAttempt.count({
          where: { assignmentId: assignment.id },
        });

        const uniqueRecentUsers = new Set(
          recentAttempts.map((a: any) => a.userId),
        ).size;
        const recentCompletions = recentAttempts.filter(
          (a: any) => a.submitted,
        ).length;

        return {
          id: assignment.id,
          name: assignment.name,
          recentAttempts: recentAttempts.length,
          uniqueRecentUsers,
          recentCompletions,
          totalAttempts,
          feedback: assignment.AssignmentFeedback.length,
          published: assignment.published,
          createdAt: assignment.updatedAt,
        };
      }),
    );

    return {
      title: `${limit} Assignments with Highest Recent Activity (7 days)`,
      data: assignmentsWithActivity
        .sort((a, b) => b.recentAttempts - a.recentAttempts)
        .slice(0, limit),
    };
  }

  private async getCostPerLearnerAnalysis(assignmentWhere: any, limit: number) {
    const assignments = await this.prisma.assignment.findMany({
      where: assignmentWhere,
      select: {
        id: true,
        name: true,
        published: true,
        updatedAt: true,
        AIUsage: {
          select: {
            tokensIn: true,
            tokensOut: true,
            createdAt: true,
            usageType: true,
            modelKey: true,
          },
        },
      },
      take: Math.min(limit * 10, 1000),
    });

    const assignmentsWithCostPerLearner = await Promise.all(
      assignments.map(async (assignment) => {
        const costData = await this.calculateHistoricalCosts(
          assignment.AIUsage,
        );

        const attempts = await this.prisma.assignmentAttempt.findMany({
          where: { assignmentId: assignment.id },
          select: {
            userId: true,
            submitted: true,
          },
        });

        const uniqueLearners = new Set(attempts.map((a: any) => a.userId)).size;
        const costPerLearner =
          uniqueLearners > 0 ? costData.totalCost / uniqueLearners : 0;

        return {
          id: assignment.id,
          name: assignment.name,
          totalCost: costData.totalCost,
          uniqueLearners,
          costPerLearner,
          totalAttempts: attempts.length,
          published: assignment.published,
          createdAt: assignment.updatedAt,
        };
      }),
    );

    return {
      title: `${limit} Assignments - Cost Per Learner Analysis`,
      data: assignmentsWithCostPerLearner
        .filter((a) => a.uniqueLearners > 0)
        .sort((a, b) => b.costPerLearner - a.costPerLearner)
        .slice(0, limit),
    };
  }

  private async getCompletionRateAnalysis(assignmentWhere: any, limit: number) {
    const assignments = await this.prisma.assignment.findMany({
      where: assignmentWhere,
      select: {
        id: true,
        name: true,
        published: true,
        updatedAt: true,
        AssignmentFeedback: { select: { id: true } },
      },
      take: Math.min(limit * 10, 1000),
    });

    const assignmentsWithCompletionRate = await Promise.all(
      assignments.map(async (assignment) => {
        const attempts = await this.prisma.assignmentAttempt.findMany({
          where: { assignmentId: assignment.id },
          select: {
            userId: true,
            submitted: true,
          },
        });

        const uniqueUsers = new Set(attempts.map((a: any) => a.userId)).size;
        const completedUsers = new Set(
          attempts.filter((a: any) => a.submitted).map((a: any) => a.userId),
        ).size;
        const completionRate =
          uniqueUsers > 0 ? (completedUsers / uniqueUsers) * 100 : 0;

        return {
          id: assignment.id,
          name: assignment.name,
          uniqueUsers,
          completedUsers,
          totalAttempts: attempts.length,
          completionRate,
          feedback: assignment.AssignmentFeedback.length,
          published: assignment.published,
          createdAt: assignment.updatedAt,
        };
      }),
    );

    return {
      title: `${limit} Assignments - Completion Rate Analysis`,
      data: assignmentsWithCompletionRate
        .filter((a) => a.uniqueUsers > 0)
        .sort((a, b) => b.completionRate - a.completionRate)
        .slice(0, limit),
    };
  }
}
