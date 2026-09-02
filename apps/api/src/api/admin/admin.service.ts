/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma, Question, QuestionVariant } from "@prisma/client";
import {
  UserRole,
  UserSession,
} from "../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../database/prisma.service";
import { ConcurrencyLimiter } from "../llm/features/grading/services/concurrency-limiter";
import {
  Choice,
  QuestionDto,
  ScoringDto,
  UpdateAssignmentQuestionsDto,
  VariantDto,
} from "../assignment/dto/update.questions.request.dto";
import { QuestionGenerationPayload } from "../assignment/dto/post.assignment.request.dto";
import {
  CompleteAssignmentFileDto,
  InitiateAssignmentFilesDto,
  InitiateAssignmentFilesResponseDto,
} from "../assignment/v2/dtos/assignment-file-upload.dto";
import {
  AssignmentFileResponse,
  AssignmentFileService,
} from "../assignment/v2/services/assignment-file.service";
import { AssignmentServiceV2 } from "../assignment/v2/services/assignment.service";
import { JobStatusServiceV2 } from "../assignment/v2/services/job-status.service";
import { QuestionService } from "../assignment/v2/services/question.service";
import { LLMPricingService } from "../llm/core/services/llm-pricing.service";
import { toAiUsageCounterNumber } from "../llm/core/utils/ai-usage-counter.util";
import { LLM_PRICING_SERVICE } from "../llm/llm.constants";
import { AdminAddAssignmentToGroupResponseDto } from "./dto/assignment/add.assignment.to.group.response.dto";
import { AdminAddContentToAssignmentRequestDto } from "./dto/assignment/add.content.to.assignment.request.dto";
import { AdminBaseAssignmentResponseDto } from "./dto/assignment/base.assignment.response.dto";
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

type HistoricalAIUsageRecord = {
  assignmentId?: number;
  tokensIn: bigint | number;
  cachedTokensIn?: bigint | number;
  tokensOut: bigint | number;
  createdAt: Date;
  usageType?: string;
  modelKey?: string | null;
  /** Backfilled aggregate rows are useful for all-time totals but not exact. */
  isEstimated?: boolean;
  /** How many provider calls this row covers; rolled-up rows cover many. */
  recordCount?: number;
};

/** One rolled-up usage bucket: same model, usage type, pricing status, and day. */
type UsageRollupRow = {
  assignmentId?: number;
  modelKey: string;
  usageType: string;
  isEstimated: boolean;
  day: Date;
  tokensIn: bigint;
  cachedTokensIn: bigint;
  tokensOut: bigint;
  recordCount: number;
};

/** Newest provider calls kept for the per-call audit table on the insights page. */
const INSIGHTS_USAGE_EVENT_LIMIT = 200;

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  // TODO: this insights cache is a per-pod in-memory Map, so writes that change
  // an attempt (e.g. the admin force-pass in AttemptAdminService) can't
  // invalidate it across replicas — the admin analytics view stays stale for up
  // to INSIGHTS_CACHE_TTL after such a write. Accepted for now: force-pass is a
  // rare admin action, the underlying DB is updated synchronously, and the
  // acting admin gets an optimistic UI update. If insights need to be live after
  // writes, move this to a shared Redis-backed cache service (see
  // AttemptAccessCacheService / GradingCacheService) with an invalidate(assignmentId).
  private readonly insightsCache = new Map<
    string,
    { data: any; cachedAt: number }
  >();
  private readonly INSIGHTS_CACHE_TTL = 1 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly assignmentService: AssignmentServiceV2,
    private readonly assignmentFileService: AssignmentFileService,
    private readonly questionService: QuestionService,
    private readonly jobStatusService: JobStatusServiceV2,
    @Inject(LLM_PRICING_SERVICE)
    private readonly llmPricingService: LLMPricingService,
  ) {}

  /**
   * Helper method to get cached insights data
   */
  private insightsCacheKey(assignmentId: number, details: boolean): string {
    // Keyed by detail level: a lite payload (no aiUsage/costCalculationDetails)
    // must never satisfy a details=true request, and vice versa.
    return `insights:${assignmentId}:${details ? "full" : "lite"}`;
  }

  private getCachedInsights(
    assignmentId: number,
    details: boolean,
  ): any | null {
    const cacheKey = this.insightsCacheKey(assignmentId, details);
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
  private setCachedInsights(
    assignmentId: number,
    details: boolean,
    data: any,
  ): void {
    const cacheKey = this.insightsCacheKey(assignmentId, details);
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
    // Clear both detail-level variants so stale data can't survive a change.
    this.insightsCache.delete(this.insightsCacheKey(assignmentId, true));
    this.insightsCache.delete(this.insightsCacheKey(assignmentId, false));
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
        currentVersion: true,
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
              // Warm the full (details=true) variant — that's the payload the
              // admin dashboard reads, and the cache is keyed by detail level.
              await this.getDetailedAssignmentInsights(
                adminSession,
                assignment.assignmentId,
                true,
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

  /** Sums usage per model, usage type, pricing status, and day. Pricing already resolves per (model, day), so this matches summing each call. Raw SQL because Prisma cannot group on a truncated date. */
  private async rollUpUsageForCost(
    filters: {
      assignmentIds?: number[];
      from?: Date;
      to?: Date;
      excludeEstimated?: boolean;
    },
    byAssignment = false,
  ): Promise<HistoricalAIUsageRecord[]> {
    const conditions: Prisma.Sql[] = [];
    if (filters.assignmentIds) {
      if (filters.assignmentIds.length === 0) return [];
      conditions.push(
        Prisma.sql`"assignmentId" IN (${Prisma.join(filters.assignmentIds)})`,
      );
    }
    if (filters.from) {
      conditions.push(Prisma.sql`"createdAt" >= ${filters.from}`);
    }
    if (filters.to) {
      conditions.push(Prisma.sql`"createdAt" <= ${filters.to}`);
    }
    if (filters.excludeEstimated) {
      conditions.push(Prisma.sql`"isEstimated" = false`);
    }

    const assignmentColumn = byAssignment
      ? Prisma.sql`"assignmentId",`
      : Prisma.empty;
    const whereClause =
      conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
        : Prisma.empty;

    const rows = await this.prisma.$queryRaw<UsageRollupRow[]>(Prisma.sql`
      SELECT
        ${assignmentColumn}
        "modelKey",
        "usageType"::text AS "usageType",
        "isEstimated",
        date_trunc('day', "createdAt") AS "day",
        SUM("tokensIn")::bigint AS "tokensIn",
        SUM("cachedTokensIn")::bigint AS "cachedTokensIn",
        SUM("tokensOut")::bigint AS "tokensOut",
        COUNT(*)::int AS "recordCount"
      FROM "AIUsageEvent"
      ${whereClause}
      GROUP BY
        ${assignmentColumn}
        "modelKey",
        "usageType",
        "isEstimated",
        date_trunc('day', "createdAt")
    `);

    return rows.map((row) => ({
      assignmentId: row.assignmentId,
      tokensIn: row.tokensIn,
      cachedTokensIn: row.cachedTokensIn,
      tokensOut: row.tokensOut,
      createdAt: row.day,
      usageType: row.usageType,
      modelKey: row.modelKey,
      isEstimated: row.isEstimated,
      recordCount: row.recordCount,
    }));
  }

  /** Rolled-up usage keyed by assignment, for per-assignment cost totals. */
  private async rollUpUsageByAssignment(
    assignmentIds: number[],
  ): Promise<Map<number, HistoricalAIUsageRecord[]>> {
    const rows = await this.rollUpUsageForCost(
      { assignmentIds },
      /* byAssignment */ true,
    );
    const byAssignment = new Map<number, HistoricalAIUsageRecord[]>();
    for (const row of rows) {
      // byAssignment guarantees assignmentId is selected.
      const list = byAssignment.get(row.assignmentId);
      if (list) {
        list.push(row);
      } else {
        byAssignment.set(row.assignmentId, [row]);
      }
    }
    return byAssignment;
  }

  /**
   * Helper method to calculate costs using historical pricing data with detailed breakdown
   */
  private async calculateHistoricalCosts(
    aiUsageRecords: HistoricalAIUsageRecord[],
  ): Promise<{
    totalCost: number;
    exactCost: number;
    estimatedCost: number;
    unpricedRecordCount: number;
    costBreakdown: {
      grading: number;
      questionGeneration: number;
      translation: number;
      other: number;
    };
    /** Cost per raw AIUsageType, for callers that need their own buckets. */
    costByUsageType: Record<string, number>;
    detailedBreakdown: Array<{
      tokensIn: number;
      cachedTokensIn: number;
      tokensOut: number;
      inputCost: number;
      cachedInputCost: number;
      outputCost: number;
      totalCost: number;
      usageDate: Date;
      modelKey: string;
      inputTokenPrice: number;
      cachedInputTokenPrice: number;
      outputTokenPrice: number;
      pricingEffectiveDate: Date;
      usageType?: string;
      isEstimated: boolean;
      pricingStatus: "exact" | "estimated" | "unpriced";
      /** Provider calls covered by this row; above 1 the row is a rollup. */
      recordCount: number;
      calculationSteps: {
        inputCalculation: string;
        cachedInputCalculation: string;
        outputCalculation: string;
        totalCalculation: string;
      };
    }>;
  }> {
    let totalCost = 0;
    let exactCost = 0;
    let estimatedCost = 0;
    let unpricedRecordCount = 0;
    const detailedBreakdown = [];
    const costByUsageType: Record<string, number> = {};
    const costByType = {
      grading: 0,
      questionGeneration: 0,
      translation: 0,
      other: 0,
    };

    // Coerce counters safely; rows with no model key stay unpriced.
    const normalized = aiUsageRecords.map((usage) => {
      const tokensIn = toAiUsageCounterNumber(
        usage.tokensIn,
        "AIUsage.tokensIn",
      );
      const tokensOut = toAiUsageCounterNumber(
        usage.tokensOut,
        "AIUsage.tokensOut",
      );
      const cachedTokensIn = toAiUsageCounterNumber(
        usage.cachedTokensIn ?? 0,
        "AIUsage.cachedTokensIn",
      );
      const modelKey = usage.modelKey;
      if (!modelKey) {
        this.logger.warn(
          `Usage record from ${usage.createdAt.toISOString()} has no model key; cost will be reported as unpriced`,
        );
      }
      return { usage, tokensIn, cachedTokensIn, tokensOut, modelKey };
    });

    const breakdowns = await this.llmPricingService.calculateCostBatch(
      normalized
        .filter((n): n is typeof n & { modelKey: string } => !!n.modelKey)
        .map((n) => ({
          modelKey: n.modelKey,
          inputTokens: n.tokensIn,
          cachedInputTokens: n.cachedTokensIn,
          outputTokens: n.tokensOut,
          usageDate: n.usage.createdAt,
          usageType: n.usage.usageType,
        })),
    );

    let pricedIndex = 0;
    for (const item of normalized) {
      const { usage, tokensIn, cachedTokensIn, tokensOut, modelKey } = item;
      const costBreakdown = modelKey ? breakdowns[pricedIndex++] : null;

      if (costBreakdown) {
        totalCost += costBreakdown.totalCost;
        const pricingIsForwardDated =
          costBreakdown.pricingEffectiveDate > usage.createdAt;
        const isEstimated = !!usage.isEstimated || pricingIsForwardDated;
        if (isEstimated) {
          estimatedCost += costBreakdown.totalCost;
        } else {
          exactCost += costBreakdown.totalCost;
        }

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

        // Exact usage-type totals too, so callers can bucket them their own way.
        const rawUsageType = usage.usageType ?? "UNKNOWN";
        costByUsageType[rawUsageType] =
          (costByUsageType[rawUsageType] ?? 0) + costBreakdown.totalCost;

        const inputPricePerMillion = costBreakdown.inputTokenPrice * 1_000_000;
        const cachedInputPricePerMillion =
          costBreakdown.cachedInputTokenPrice * 1_000_000;
        const outputPricePerMillion =
          costBreakdown.outputTokenPrice * 1_000_000;
        const calculationSteps = {
          inputCalculation: `${(
            tokensIn - cachedTokensIn
          ).toLocaleString()} uncached tokens × $${inputPricePerMillion.toFixed(
            2,
          )}/1M tokens = $${costBreakdown.inputCost.toFixed(8)}`,
          cachedInputCalculation: `${cachedTokensIn.toLocaleString()} cached tokens × $${cachedInputPricePerMillion.toFixed(
            2,
          )}/1M tokens = $${costBreakdown.cachedInputCost.toFixed(8)}`,
          outputCalculation: `${tokensOut.toLocaleString()} tokens × $${outputPricePerMillion.toFixed(
            2,
          )}/1M tokens = $${costBreakdown.outputCost.toFixed(8)}`,
          totalCalculation: `$${costBreakdown.inputCost.toFixed(
            8,
          )} + $${costBreakdown.cachedInputCost.toFixed(
            8,
          )} cached + $${costBreakdown.outputCost.toFixed(
            8,
          )} = $${costBreakdown.totalCost.toFixed(8)}`,
        };

        detailedBreakdown.push({
          tokensIn,
          cachedTokensIn,
          tokensOut,
          inputCost: costBreakdown.inputCost,
          cachedInputCost: costBreakdown.cachedInputCost,
          outputCost: costBreakdown.outputCost,
          totalCost: costBreakdown.totalCost,
          usageDate: usage.createdAt,
          modelKey: costBreakdown.modelKey,
          inputTokenPrice: costBreakdown.inputTokenPrice,
          cachedInputTokenPrice: costBreakdown.cachedInputTokenPrice,
          outputTokenPrice: costBreakdown.outputTokenPrice,
          pricingEffectiveDate: costBreakdown.pricingEffectiveDate,
          usageType: usage.usageType,
          isEstimated,
          pricingStatus: isEstimated ? "estimated" : "exact",
          recordCount: usage.recordCount ?? 1,
          calculationSteps,
        });
      } else {
        this.logger.error(
          `No pricing found for ${modelKey || "unknown"} at ${usage.createdAt.toISOString()}; excluding from cost total`,
        );
        unpricedRecordCount += usage.recordCount ?? 1;
        const calculationSteps = {
          inputCalculation: `${tokensIn.toLocaleString()} input tokens × unknown rate = unpriced`,
          cachedInputCalculation: `${cachedTokensIn.toLocaleString()} cached input tokens × unknown rate = unpriced`,
          outputCalculation: `${tokensOut.toLocaleString()} output tokens × unknown rate = unpriced`,
          totalCalculation:
            "No total included because the model has no verified price",
        };

        detailedBreakdown.push({
          tokensIn,
          tokensOut,
          cachedTokensIn,
          inputCost: 0,
          cachedInputCost: 0,
          outputCost: 0,
          totalCost: 0,
          usageDate: usage.createdAt,
          modelKey: modelKey || "unknown",
          inputTokenPrice: 0,
          cachedInputTokenPrice: 0,
          outputTokenPrice: 0,
          pricingEffectiveDate: usage.createdAt,
          usageType: usage.usageType,
          isEstimated: !!usage.isEstimated,
          pricingStatus: "unpriced",
          recordCount: usage.recordCount ?? 1,
          calculationSteps,
        });
      }
    }

    return {
      totalCost,
      exactCost,
      estimatedCost,
      unpricedRecordCount,
      costBreakdown: costByType,
      costByUsageType,
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
            // Count provider calls, not aggregate rows, so the buckets mean something.
            AIUsageEvent: true,
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
        (sum, assignment) => sum + assignment._count.AIUsageEvent,
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
  ): Promise<AdminBaseAssignmentResponseDto> {
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
  ): Promise<AdminBaseAssignmentResponseDto> {
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

  async getAssignmentFiles(
    assignmentId: number,
  ): Promise<{ files: AssignmentFileResponse[] }> {
    await this.assertAssignmentExists(assignmentId);
    return this.assignmentFileService.getAssignmentFiles(assignmentId);
  }

  async initiateAssignmentFileUploads(
    assignmentId: number,
    dto: InitiateAssignmentFilesDto,
    userId = "admin-api",
  ): Promise<InitiateAssignmentFilesResponseDto> {
    await this.assertAssignmentExists(assignmentId);
    return this.assignmentFileService.initiateAssignmentFileUploads(
      assignmentId,
      dto,
      userId,
    );
  }

  async completeAssignmentFileUpload(
    assignmentId: number,
    fileId: number,
    dto: CompleteAssignmentFileDto,
  ) {
    await this.assertAssignmentExists(assignmentId);
    return this.assignmentFileService.completeAssignmentFileUpload(
      assignmentId,
      fileId,
      dto,
    );
  }

  async abortAssignmentFileUpload(
    assignmentId: number,
    fileId: number,
  ): Promise<void> {
    await this.assertAssignmentExists(assignmentId);
    return this.assignmentFileService.abortAssignmentFileUpload(
      assignmentId,
      fileId,
    );
  }

  async deleteAssignmentFile(
    assignmentId: number,
    fileId: number,
  ): Promise<void> {
    await this.assertAssignmentExists(assignmentId);
    return this.assignmentFileService.deleteAssignmentFile(
      assignmentId,
      fileId,
    );
  }

  async generateQuestions(
    assignmentId: number,
    payload: QuestionGenerationPayload,
    userId = "admin-api",
  ): Promise<{ message: string; jobId: string }> {
    await this.assertAssignmentExists(assignmentId);
    return this.questionService.generateQuestions(
      assignmentId,
      {
        ...payload,
        assignmentId,
      },
      userId,
    );
  }

  async getQuestionGenerationJobStatus(jobId: string): Promise<{
    status: string;
    progress: string;
    questions?: QuestionDto[];
  }> {
    const job = await this.jobStatusService.getJobStatus(jobId);
    if (!job) {
      throw new NotFoundException("Job not found");
    }

    return job.status === "Completed"
      ? {
          status: job.status,
          progress: job.progress,
          questions: job.result as QuestionDto[] | undefined,
        }
      : { status: job.status, progress: job.progress };
  }

  async publishAssignment(
    assignmentId: number,
    payload: UpdateAssignmentQuestionsDto,
    userId = "admin-api",
  ): Promise<{ message: string; jobId: string }> {
    await this.assertAssignmentExists(assignmentId);
    return this.assignmentService.publishAssignment(
      assignmentId,
      {
        ...payload,
        published: true,
      },
      userId,
    );
  }

  async updateAssignment(
    id: number,
    updateAssignmentDto: AdminUpdateAssignmentRequestDto,
  ): Promise<AdminBaseAssignmentResponseDto> {
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
  ): Promise<AdminBaseAssignmentResponseDto> {
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
    details?: boolean,
    sortBy?: "name" | "updatedAt" | "published",
    sortOrder?: "asc" | "desc",
    published?: boolean,
  ) {
    const isAdmin = adminSession.role === UserRole.ADMIN;
    const skip = (page - 1) * limit;

    // How many assignments' cost chains may compute at once. Each chain does
    // per-row pricing lookups (one pool connection at a time), so this bounds
    // how many connections this endpoint can hold concurrently.
    const COST_CALC_CONCURRENCY = 4;

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
      ...(published === undefined ? {} : { published }),
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

    const orderBy = { [sortBy ?? "updatedAt"]: sortOrder ?? "desc" } as Record<
      string,
      "asc" | "desc"
    >;

    const emptyAggregates = {
      totalAssignments: 0,
      totalCost: 0,
      exactCost: 0,
      estimatedCost: 0,
      unpricedRecordCount: 0,
      totalLearnerAssignmentPairs: 0,
      averageRating: 0,
    };

    const [assignments, allMatchingIds] = await Promise.all([
      this.prisma.assignment.findMany({
        where: whereClause,
        skip,
        take: limit,
        select: {
          id: true,
          name: true,
          published: true,
          updatedAt: true,
        },
        orderBy,
      }),
      this.prisma.assignment
        .findMany({ where: whereClause, select: { id: true } })
        .then((rows) => rows.map((r) => r.id)),
    ]);

    // The id-only scan already enumerates every matching row, so its length is
    // the total — no need for a separate count() roundtrip on the same filter.
    const totalCount = allMatchingIds.length;

    // Aggregates reflect the entire filtered set, not just the current page.
    // Fire as early as possible so it runs concurrently with the page-stats work.
    const aggregatesPromise =
      allMatchingIds.length === 0
        ? Promise.resolve(emptyAggregates)
        : this.computeAnalyticsAggregates(allMatchingIds, totalCount).catch(
            (error) => {
              // Never let the (early-fired) aggregates promise reject without a
              // handler — if the page-stats path throws first, an unhandled
              // rejection could crash the process. Degrade to empty cards.
              this.logger.error(
                "Failed to compute analytics aggregates",
                error,
              );
              return emptyAggregates;
            },
          );

    if (assignments.length === 0) {
      return {
        data: [],
        pagination: {
          total: totalCount,
          page,
          limit,
          totalPages: Math.ceil(totalCount / limit),
        },
        aggregates: await aggregatesPromise,
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

        // Distinct learners per assignment in ONE query: grouping by
        // (assignmentId, userId) yields one row per unique pair, so counting
        // rows per assignmentId is the unique-learner count. Replaces a
        // per-assignment findMany (one Postgres query each) that fanned out
        // across the whole page.
        this.prisma.assignmentAttempt
          .groupBy({
            by: ["assignmentId", "userId"],
            where: { assignmentId: { in: assignmentIds } },
          })
          .then((pairs) => {
            const counts = new Map<number, number>();
            for (const pair of pairs) {
              counts.set(
                pair.assignmentId,
                (counts.get(pair.assignmentId) ?? 0) + 1,
              );
            }
            return assignmentIds.map((assignmentId) => ({
              assignmentId,
              uniqueUsersCount: counts.get(assignmentId) ?? 0,
            }));
          }),

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

    // Roll up in SQL; reading raw events scans one row per provider call.
    const aiUsageByAssignment =
      await this.rollUpUsageByAssignment(assignmentIds);

    // Cost calculation does per-row pricing lookups, so running every
    // assignment's cost chain at once would hold one pool connection per
    // assignment and could starve the pool. Bound how many run concurrently —
    // the page is already capped (controller), this caps connections too.
    const analyticsData = await new ConcurrencyLimiter(
      COST_CALC_CONCURRENCY,
    ).run(
      assignments.map((assignment) => async () => {
        const totalAttempts = totalStatsMap.get(assignment.id) || 0;
        const submittedData = submittedStatsMap.get(assignment.id);
        const completedAttempts = submittedData?._count.id || 0;
        const uniqueLearners = uniqueLearnersMap.get(assignment.id) || 0;
        const feedback = feedbackMap.get(assignment.id);
        const averageGrade = (submittedData?._avg.grade || 0) * 100;
        const averageRating = feedback?._avg.assignmentRating || 0;

        const aiUsageDetails = aiUsageByAssignment.get(assignment.id) || [];

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
          grading: costData.costBreakdown.grading,
          questionGeneration: costData.costBreakdown.questionGeneration,
          translation: costData.costBreakdown.translation,
          other: costData.costBreakdown.other,
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
            exactCost: costData.exactCost,
            estimatedCost: costData.estimatedCost,
            unpricedRecordCount: costData.unpricedRecordCount,
            ...(details && {
              detailedCostBreakdown: costData.detailedBreakdown.map(
                (detail) => ({
                  ...detail,
                  usageDate: detail.usageDate.toISOString(),
                  pricingEffectiveDate:
                    detail.pricingEffectiveDate.toISOString(),
                }),
              ),
            }),
          },
        };
      }),
    );

    const aggregates = await aggregatesPromise;

    return {
      data: analyticsData,
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit),
      },
      aggregates,
    };
  }

  /** Compute filter-wide analytics aggregates using SQL grouping. */
  private async computeAnalyticsAggregates(
    allMatchingIds: number[],
    totalCount: number,
  ) {
    const assignmentIdFilter = { assignmentId: { in: allMatchingIds } };

    const [pairRows, feedbackAgg, allAiUsage] = await Promise.all([
      // Count grouped pairs in Node; use raw SQL if scale requires it.
      this.prisma.assignmentAttempt.groupBy({
        by: ["assignmentId", "userId"],
        where: assignmentIdFilter,
      }),
      this.prisma.assignmentFeedback.aggregate({
        where: {
          ...assignmentIdFilter,
          assignmentRating: { not: null },
        },
        _avg: { assignmentRating: true },
      }),
      // Rolled up in SQL: the card only needs totals, not every call.
      this.rollUpUsageForCost({ assignmentIds: allMatchingIds }),
    ]);

    const costData = await this.calculateHistoricalCosts(allAiUsage);

    return {
      totalAssignments: totalCount,
      totalCost: costData.totalCost,
      exactCost: costData.exactCost,
      estimatedCost: costData.estimatedCost,
      unpricedRecordCount: costData.unpricedRecordCount,
      totalLearnerAssignmentPairs: pairRows.length,
      averageRating: feedbackAgg._avg.assignmentRating ?? 0,
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
                      userId: {
                        equals: filters.userId,
                        mode: "insensitive" as const,
                      },
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
                          equals: filters.userId,
                          mode: "insensitive" as const,
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
                ? {
                    userId: {
                      equals: filters.userId,
                      mode: "insensitive" as const,
                    },
                  }
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
                      userId: {
                        equals: filters.userId,
                        mode: "insensitive" as const,
                      },
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
                          equals: filters.userId,
                          mode: "insensitive" as const,
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
                ? {
                    userId: {
                      equals: filters.userId,
                      mode: "insensitive" as const,
                    },
                  }
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
                      userId: {
                        equals: filters.userId,
                        mode: "insensitive" as const,
                      },
                    }
                  : {}),
              },
            })
            .then((users) => users.length)
        : 0,

      isAdmin || assignmentIds.length > 0
        ? // assignmentIds already covers the author's own assignments.
          this.rollUpUsageForCost({
            ...(assignmentIds.length > 0 ? { assignmentIds } : {}),
            ...(dateFilter.gte ? { from: dateFilter.gte } : {}),
            ...(dateFilter.lte ? { to: dateFilter.lte } : {}),
            // Backfilled rows have no real per-call date, so exclude them here.
            excludeEstimated: Object.keys(dateFilter).length > 0,
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
                ? {
                    userId: {
                      equals: filters.userId,
                      mode: "insensitive" as const,
                    },
                  }
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
      totalCost,
      exactCost: costData.exactCost,
      estimatedCost: costData.estimatedCost,
      unpricedRecordCount: costData.unpricedRecordCount,
      costBreakdown: {
        grading: costData.costBreakdown.grading,
        questionGeneration: costData.costBreakdown.questionGeneration,
        translation: costData.costBreakdown.translation,
        other: costData.costBreakdown.other,
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
    details?: boolean,
  ) {
    try {
      const cachedInsights = this.getCachedInsights(assignmentId, !!details);
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

      // Per-question insights power both the admin and author detail views, so
      // always compute them. One groupBy gathers per-question response counts +
      // average points; N parallel counts gather "fully-correct" counts.
      let questionInsights: Array<{
        id: number;
        question: string;
        type: any;
        totalPoints: number;
        correctPercentage: number;
        averagePoints: number;
        responseCount: number;
        insight: string;
        variants: number;
        translations: { languageCode: string }[];
      }> = [];

      try {
        const questionIds = assignment.questions.map((q) => q.id);
        const responseStats = await this.prisma.questionResponse.groupBy({
          by: ["questionId"],
          where: {
            questionId: { in: questionIds },
            assignmentAttempt: { assignmentId },
          },
          _count: { id: true },
          _avg: { points: true },
        });
        const statsMap = new Map(
          responseStats.map((s) => [
            s.questionId,
            {
              totalResponses: s._count.id,
              averagePoints: s._avg.points || 0,
            },
          ]),
        );

        const correctCounts = await Promise.all(
          assignment.questions.map((q) =>
            this.prisma.questionResponse.count({
              where: {
                questionId: q.id,
                assignmentAttempt: { assignmentId },
                points: q.totalPoints,
              },
            }),
          ),
        );
        const correctCountMap = new Map(
          assignment.questions.map((q, index) => [q.id, correctCounts[index]]),
        );

        questionInsights = assignment.questions.map((question) => {
          const stats = statsMap.get(question.id) ?? {
            totalResponses: 0,
            averagePoints: 0,
          };
          const correctCount = correctCountMap.get(question.id) ?? 0;
          const correctPercentage =
            stats.totalResponses > 0
              ? (correctCount / stats.totalResponses) * 100
              : 0;
          let insight = `${Math.round(correctPercentage)}% of learners answered correctly`;
          if (correctPercentage < 50) {
            insight += ` - consider reviewing this question`;
          }
          return {
            id: question.id,
            question: question.question,
            type: question.type,
            totalPoints: question.totalPoints,
            correctPercentage,
            averagePoints: stats.averagePoints,
            responseCount: stats.totalResponses,
            insight,
            variants: question.variants.length,
            translations: question.translations.map((t) => ({
              languageCode: t.languageCode,
            })),
          };
        });
      } catch (error) {
        this.logger.error(
          `Error fetching batched question statistics for assignment ${assignmentId}:`,
          error,
        );
        questionInsights = assignment.questions.map((question) => ({
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
      }

      const uniqueLearners = await this.prisma.assignmentAttempt.groupBy({
        by: ["userId"],
        where: { assignmentId },
      });

      const completedAttempts = submittedAttempts;
      const averageGrade = calculatedAverageGrade;

      // Totals cover all history; the audit table shows only the newest calls.
      const [rolledUpUsage, recentUsageEvents] = await Promise.all([
        this.rollUpUsageForCost({ assignmentIds: [assignmentId] }),
        this.prisma.aIUsageEvent.findMany({
          where: { assignmentId },
          orderBy: { createdAt: "desc" },
          take: INSIGHTS_USAGE_EVENT_LIMIT,
        }),
      ]);

      const costData = await this.calculateHistoricalCosts(rolledUpUsage);
      const totalCost = costData.totalCost;
      const recentUsageCost =
        await this.calculateHistoricalCosts(recentUsageEvents);
      const totalCalls = rolledUpUsage.reduce(
        (sum, row) => sum + (row.recordCount ?? 1),
        0,
      );

      const authorActivity = await this.getAuthorActivity(
        assignment.AssignmentAuthor,
      );

      const aiUsageWithCost = recentUsageEvents.map((usage, index) => {
        const detailedCost = recentUsageCost.detailedBreakdown[index] || {
          totalCost: 0,
          inputCost: 0,
          cachedInputCost: 0,
          outputCost: 0,
          modelKey: "unknown",
          inputTokenPrice: 0,
          cachedInputTokenPrice: 0,
          outputTokenPrice: 0,
          pricingEffectiveDate: new Date(),
          isEstimated: false,
          pricingStatus: "unpriced" as const,
          calculationSteps: {
            inputCalculation: "0 tokens × $0 = $0 (missing)",
            cachedInputCalculation: "0 cached tokens × $0 = $0 (missing)",
            outputCalculation: "0 tokens × $0 = $0 (missing)",
            totalCalculation: "$0 + $0 = $0 (missing)",
          },
        };

        return {
          usageType: usage.usageType,
          tokensIn: toAiUsageCounterNumber(usage.tokensIn, "AIUsage.tokensIn"),
          cachedTokensIn: toAiUsageCounterNumber(
            usage.cachedTokensIn,
            "AIUsageEvent.cachedTokensIn",
          ),
          tokensOut: toAiUsageCounterNumber(
            usage.tokensOut,
            "AIUsage.tokensOut",
          ),
          usageCount: toAiUsageCounterNumber(
            BigInt(1),
            "AIUsageEvent.usageCount",
          ),
          inputCost: detailedCost.inputCost,
          cachedInputCost: detailedCost.cachedInputCost,
          outputCost: detailedCost.outputCost,
          totalCost: detailedCost.totalCost,
          modelUsed: detailedCost.modelKey,
          inputTokenPrice: detailedCost.inputTokenPrice,
          cachedInputTokenPrice: detailedCost.cachedInputTokenPrice,
          outputTokenPrice: detailedCost.outputTokenPrice,
          pricingEffectiveDate: detailedCost.pricingEffectiveDate.toISOString(),
          calculationSteps: detailedCost.calculationSteps,
          createdAt: usage.createdAt.toISOString(),
          isEstimated: detailedCost.isEstimated,
          pricingStatus: detailedCost.pricingStatus,
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
        ...(details && {
          aiUsage: aiUsageWithCost,
          costCalculationDetails: {
            totalCost,
            exactCost: costData.exactCost,
            estimatedCost: costData.estimatedCost,
            unpricedRecordCount: costData.unpricedRecordCount,
            costByUsageType: costData.costByUsageType,
            totalCalls,
            // Totals above cover every call; these rows are the newest slice.
            breakdownTruncated: totalCalls > recentUsageEvents.length,
            breakdown: recentUsageCost.detailedBreakdown.map((detail) => ({
              usageType: detail.usageType || "Unknown",
              tokensIn: detail.tokensIn,
              cachedTokensIn: detail.cachedTokensIn,
              tokensOut: detail.tokensOut,
              modelUsed: detail.modelKey,
              inputTokenPrice: detail.inputTokenPrice,
              cachedInputTokenPrice: detail.cachedInputTokenPrice,
              outputTokenPrice: detail.outputTokenPrice,
              inputCost: detail.inputCost,
              cachedInputCost: detail.cachedInputCost,
              outputCost: detail.outputCost,
              totalCost: detail.totalCost,
              pricingEffectiveDate: detail.pricingEffectiveDate.toISOString(),
              usageDate: detail.usageDate.toISOString(),
              isEstimated: detail.isEstimated,
              pricingStatus: detail.pricingStatus,
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
              totalCachedInputTokens: costData.detailedBreakdown.reduce(
                (sum, d) => sum + d.cachedTokensIn,
                0,
              ),
              totalInputCost: costData.detailedBreakdown.reduce(
                (sum, d) => sum + d.inputCost,
                0,
              ),
              totalCachedInputCost: costData.detailedBreakdown.reduce(
                (sum, d) => sum + d.cachedInputCost,
                0,
              ),
              totalOutputCost: costData.detailedBreakdown.reduce(
                (sum, d) => sum + d.outputCost,
                0,
              ),
              averageInputPrice:
                costData.detailedBreakdown.reduce(
                  (sum, d) => sum + (d.tokensIn - d.cachedTokensIn),
                  0,
                ) > 0
                  ? costData.detailedBreakdown.reduce(
                      (sum, d) => sum + d.inputCost,
                      0,
                    ) /
                    costData.detailedBreakdown.reduce(
                      (sum, d) => sum + (d.tokensIn - d.cachedTokensIn),
                      0,
                    )
                  : 0,
              averageCachedInputPrice:
                costData.detailedBreakdown.reduce(
                  (sum, d) => sum + d.cachedTokensIn,
                  0,
                ) > 0
                  ? costData.detailedBreakdown.reduce(
                      (sum, d) => sum + d.cachedInputCost,
                      0,
                    ) /
                    costData.detailedBreakdown.reduce(
                      (sum, d) => sum + d.cachedTokensIn,
                      0,
                    )
                  : 0,
              averageOutputPrice:
                costData.detailedBreakdown.reduce(
                  (sum, d) => sum + d.tokensOut,
                  0,
                ) > 0
                  ? costData.detailedBreakdown.reduce(
                      (sum, d) => sum + d.outputCost,
                      0,
                    ) /
                    costData.detailedBreakdown.reduce(
                      (sum, d) => sum + d.tokensOut,
                      0,
                    )
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
                grading: costData.costBreakdown.grading,
                questionGeneration: costData.costBreakdown.questionGeneration,
                translation: costData.costBreakdown.translation,
                other: costData.costBreakdown.other,
              },
            },
          },
        }),
        authorActivity: {
          totalAuthors: authorActivity.totalAuthors,
          authors: authorActivity.authors,
          activityInsights: authorActivity.activityInsights,
        },
      };

      this.setCachedInsights(assignmentId, !!details, insights);

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

  async removeAssignment(id: number): Promise<AdminBaseAssignmentResponseDto> {
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

    // Clean up COS objects before the cascade-delete removes the AssignmentFile
    // rows, so we still have the storageKey/storageBucket references.
    // S3 failures are logged as warnings and never block the deletion.
    await this.assignmentFileService.cleanupAssignmentFileObjects(id);

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

  /**
   * Helper method to map question DTO to Prisma question data
   */
  private mapQuestionDataForCreation(questionData: any, assignmentId: number) {
    const scoring = questionData.scoring
      ? (questionData.scoring as object)
      : undefined;
    const choices = questionData.choices
      ? (JSON.parse(
          JSON.stringify(questionData.choices),
        ) as Prisma.InputJsonValue)
      : Prisma.JsonNull;

    return {
      assignmentId,
      type: questionData.type,
      question: questionData.question,
      responseType: questionData.responseType,
      maxWords: questionData.maxWords,
      maxCharacters: questionData.maxCharacters,
      totalPoints: questionData.totalPoints,
      randomizedChoices: questionData.randomizedChoices,
      choices,
      scoring,
    };
  }

  /**
   * Add content (details, configuration, and questions) to an existing empty assignment.
   * Uses a transaction to ensure atomicity - if any step fails, all changes are rolled back.
   *
   * @param id - The assignment ID
   * @param addContentRequestDto - The content to add
   * @returns Success response with updated assignment info
   * @throws NotFoundException if assignment doesn't exist
   */
  async addContentToAssignment(
    id: number,
    addContentRequestDto: AdminAddContentToAssignmentRequestDto,
    userId = "system",
  ): Promise<AdminBaseAssignmentResponseDto> {
    const { assignment, config, gradingCriteria, questions } =
      addContentRequestDto;
    // Strip fields that don't exist in the assignment table (e.g., learningObjectives)
    const { ...assignmentDetails } = assignment;

    const result = await this.prisma.$transaction(async (tx) => {
      const existingAssignment = await tx.assignment.findUnique({
        where: { id },
        include: {
          _count: {
            select: { questions: true },
          },
        },
      });

      if (!existingAssignment) {
        throw new NotFoundException(`Assignment with Id ${id} not found.`);
      }

      if (existingAssignment._count.questions > 0) {
        this.logger.warn(
          `Assignment ${id} already has ${existingAssignment._count.questions} questions. Adding ${questions.length} more.`,
        );
      }

      const updatedAssignment = await tx.assignment.update({
        where: { id },
        data: {
          ...assignmentDetails,
          gradingCriteriaOverview: gradingCriteria,
          published: false,
          numAttempts: config.numAttempts,
          attemptsBeforeCoolDown: config.attemptsBeforeCoolDown,
          retakeAttemptCoolDownMinutes: config.retakeAttemptCoolDownMinutes,
          passingGrade: config.passingGrade,
          displayOrder: config.displayOrder,
          graded: config.graded,
          questionDisplay: config.questionDisplay,
          showQuestions: config.showQuestions,
          showSubmissionFeedback: config.showSubmissionFeedback,
          showAssignmentScore: config.showAssignmentScore,
          numberOfQuestionsPerAttempt: config.numberOfQuestionsPerAttempt,
          timeEstimateMinutes: config.timeEstimateMinutes,
          allotedTimeMinutes: config.allotedTimeMinutes,
          attemptsPerTimeRange: config.attemptsPerTimeRange,
          attemptsTimeRangeHours: config.attemptsTimeRangeHours,
          showQuestionScore: config.showQuestionScore,
          showPassFailIndicator: config.showPassFailIndicator ?? false,
          correctAnswerVisibility: config.correctAnswerVisibility,
        },
      });

      const createdQuestions: any[] = [];
      if (questions.length > 0) {
        const questionDataArray = questions.map((q) =>
          this.mapQuestionDataForCreation(q, id),
        );

        await tx.question.createMany({
          data: questionDataArray,
        });

        const fetchedQuestions = await tx.question.findMany({
          where: { assignmentId: id, isDeleted: false },
          orderBy: { id: "asc" },
        });
        createdQuestions.push(...fetchedQuestions);

        this.logger.log(
          `Successfully added ${questions.length} questions to assignment ${id}`,
        );
      }
      const questionOrder = createdQuestions.map((q) => q.id);

      await tx.assignment.update({
        where: { id },
        data: { questionOrder: questionOrder ?? [] },
      });

      return updatedAssignment;
    });

    void this.publishAssignmentAfterContent(id, userId).catch(
      (error: unknown) => {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        this.logger.error(
          `Failed to publish assignment ${id} after content import: ${errorMessage}`,
        );
      },
    );

    return {
      id: result.id,
      success: true,
      name: result.name,
      type: result.type,
    };
  }

  private async publishAssignmentAfterContent(
    assignmentId: number,
    userId: string,
  ): Promise<void> {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        questions: {
          where: { isDeleted: false },
          include: {
            variants: {
              where: { isDeleted: false },
            },
          },
        },
      },
    });

    if (!assignment) {
      this.logger.warn(
        `Assignment ${assignmentId} not found while preparing publish payload`,
      );
      return;
    }

    const questions = assignment.questions.map((question) =>
      this.mapQuestionToDto(question),
    );
    const questionOrder =
      assignment.questionOrder && assignment.questionOrder.length > 0
        ? assignment.questionOrder
        : questions.map((q) => q.id);

    const publishPayload: UpdateAssignmentQuestionsDto = {
      name: assignment.name,
      questions,
      introduction: assignment.introduction ?? null,
      instructions: assignment.instructions ?? null,
      gradingCriteriaOverview: assignment.gradingCriteriaOverview ?? null,
      timeEstimateMinutes: assignment.timeEstimateMinutes ?? null,
      graded: assignment.graded ?? false,
      numAttempts: assignment.numAttempts ?? null,
      attemptsBeforeCoolDown: assignment.attemptsBeforeCoolDown ?? null,
      retakeAttemptCoolDownMinutes:
        assignment.retakeAttemptCoolDownMinutes ?? null,
      allotedTimeMinutes: assignment.allotedTimeMinutes ?? null,
      attemptsPerTimeRange: assignment.attemptsPerTimeRange ?? null,
      attemptsTimeRangeHours: assignment.attemptsTimeRangeHours ?? null,
      passingGrade: assignment.passingGrade ?? null,
      displayOrder: assignment.displayOrder ?? null,
      questionDisplay: assignment.questionDisplay ?? null,
      numberOfQuestionsPerAttempt:
        assignment.numberOfQuestionsPerAttempt ?? null,
      published: true,
      questionOrder,
      showAssignmentScore: assignment.showAssignmentScore ?? false,
      showQuestionScore: assignment.showQuestionScore ?? false,
      showPassFailIndicator: assignment.showPassFailIndicator ?? false,
      showSubmissionFeedback: assignment.showSubmissionFeedback ?? false,
      showQuestions: assignment.showQuestions ?? false,
      correctAnswerVisibility: assignment.correctAnswerVisibility ?? undefined,
      questionControls: this.cloneJsonValue(assignment.questionControls),
      versionDescription: "Published via admin content import",
      versionNumber: "",
      updatedAt: assignment.updatedAt,
    };

    await this.assignmentService.publishAssignment(
      assignmentId,
      publishPayload,
      userId,
    );
  }

  private mapQuestionToDto(
    question: Question & { variants: QuestionVariant[] },
  ): QuestionDto {
    const variants: VariantDto[] = (question.variants ?? []).map((variant) => ({
      id: variant.id,
      variantContent: variant.variantContent,
      variantType: variant.variantType as VariantDto["variantType"],
      isDeleted: variant.isDeleted,
      choices: this.cloneJsonValue<Choice[]>(variant.choices),
      scoring: this.cloneJsonValue<ScoringDto>(variant.scoring),
      maxWords: variant.maxWords ?? undefined,
      maxCharacters: variant.maxCharacters ?? undefined,
      randomizedChoices: variant.randomizedChoices ?? undefined,
    }));

    return {
      id: question.id,
      assignmentId: question.assignmentId,
      // Every row reaches this helper via an assignment-scoped read, so signal
      // the publish path to update in place rather than create + delete.
      alreadyInBackend: true,
      question: question.question,
      type: question.type,
      responseType: question.responseType ?? undefined,
      totalPoints: question.totalPoints ?? undefined,
      authorComment: question.authorComment ?? null,
      choices: this.cloneJsonValue<Choice[]>(question.choices),
      scoring: this.cloneJsonValue<ScoringDto>(question.scoring),
      maxWords: question.maxWords ?? undefined,
      maxCharacters: question.maxCharacters ?? undefined,
      randomizedChoices: question.randomizedChoices ?? undefined,
      answer: question.answer ?? null,
      gradingContextQuestionIds: question.gradingContextQuestionIds ?? [],
      variants,
    };
  }

  private cloneJsonValue<T>(value?: Prisma.JsonValue | null): T | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }

    try {
      return JSON.parse(JSON.stringify(value)) as T;
    } catch {
      return undefined;
    }
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
        AssignmentFeedback: {
          select: { id: true },
        },
      },
      take: Math.min(limit * 10, 1000),
    });

    const usageByAssignment = await this.rollUpUsageByAssignment(
      assignments.map((a) => a.id),
    );

    const assignmentsWithCost = await Promise.all(
      assignments.map(async (assignment) => {
        const costData = await this.calculateHistoricalCosts(
          usageByAssignment.get(assignment.id) ?? [],
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
      },
      take: Math.min(limit * 10, 1000),
    });

    const usageByAssignment = await this.rollUpUsageByAssignment(
      assignments.map((a) => a.id),
    );

    const assignmentsWithCostPerLearner = await Promise.all(
      assignments.map(async (assignment) => {
        const costData = await this.calculateHistoricalCosts(
          usageByAssignment.get(assignment.id) ?? [],
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

  private async assertAssignmentExists(assignmentId: number): Promise<void> {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: { id: true },
    });

    if (!assignment) {
      throw new NotFoundException(
        `Assignment with Id ${assignmentId} not found.`,
      );
    }
  }
}
