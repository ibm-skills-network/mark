import { Injectable, Logger } from "@nestjs/common";
import { EnhancedAutomatedGradingService } from "../services/enhanced-automated-grading.service";
import { MonitoringService } from "../services/monitoring.service";
import {
  FinalGradeData,
  GradingContextData,
  RubricCriterion,
} from "../types/grading.types";

@Injectable()
export class TypeSafeGradingExample {
  private readonly logger = new Logger(TypeSafeGradingExample.name);

  constructor(
    private readonly gradingService: EnhancedAutomatedGradingService,
    private readonly monitoringService: MonitoringService,
  ) {}

  async demonstrateTypeSafeGrading(): Promise<void> {
    // Define rubric with full type safety
    const rubric: RubricCriterion[] = [
      {
        id: "accuracy",
        description:
          "Answer demonstrates factual accuracy and correct understanding",
        maxPoints: 10,
        keywords: ["correct", "accurate", "precise"],
      },
      {
        id: "completeness",
        description: "Answer addresses all aspects of the question",
        maxPoints: 8,
        keywords: ["complete", "comprehensive", "thorough"],
      },
      {
        id: "clarity",
        description: "Answer is well-organized and clearly expressed",
        maxPoints: 7,
        keywords: ["clear", "organized", "coherent"],
      },
    ];

    // Create fully typed grading context
    const gradingContext: GradingContextData = {
      questionId: "q_001",
      learnerAnswer:
        "Photosynthesis is the process by which plants convert sunlight, carbon dioxide, and water into glucose and oxygen. This occurs in the chloroplasts using chlorophyll.",
      rubric,
      questionType: "TEXT",
      responseType: "essay",
      timeout: 60_000,
      maxRetries: 2,
    };

    try {
      // Execute grading with full type safety
      const result =
        await this.gradingService.executeGradingPipeline(gradingContext);

      // Type-safe result handling
      if (result.success && result.finalGrade) {
        this.logSuccessfulGrading(result.finalGrade);
        this.analyzeGradingMetrics(result);
      } else {
        this.handleGradingErrors(result.errors, result.warnings);
      }

      // Get system health with proper typing
      const systemHealth = this.gradingService.getSystemHealth();
      this.logSystemHealth(systemHealth);
    } catch (error) {
      this.logger.error("Type-safe grading example failed:", error);
    }
  }

  private logSuccessfulGrading(finalGrade: FinalGradeData): void {
    this.logger.log("Grading completed successfully", {
      selectedSource: finalGrade.selectedSource,
      totalAwarded: finalGrade.grade.totalAwarded,
      totalMax: finalGrade.grade.totalMax,
      confidence: finalGrade.grade.confidence,
      processingSteps: finalGrade.processingSteps,
    });

    // Type-safe criteria analysis
    for (const award of finalGrade.grade.criteriaAwards) {
      this.logger.debug(
        `Criterion ${award.criterionId}: ${award.awarded}/${award.maxPoints}`,
        {
          justification: award.justification,
          evidence: award.evidence ?? "No evidence provided",
        },
      );
    }
  }

  private analyzeGradingMetrics(result: {
    processingTimeMs: number;
    riskLevel: "low" | "medium" | "high";
    fallbackUsed: boolean;
    debugInfo?: {
      processingSteps?: string[];
      nodeExecutionTimes?: Record<string, number>;
      errorRecovery?: unknown;
      circuitBreakerStatus?: Record<string, unknown>;
    };
  }): void {
    const performanceMetrics = {
      processingTime: result.processingTimeMs,
      riskAssessment: result.riskLevel,
      systemReliability: result.fallbackUsed ? "degraded" : "optimal",
    };

    this.logger.log("Performance analysis", performanceMetrics);

    // Risk-based alerting
    if (result.riskLevel === "high") {
      this.logger.warn(
        "High-risk grading detected - manual review recommended",
      );
    }

    if (result.fallbackUsed) {
      this.logger.warn(
        "Fallback mechanisms were used - system performance degraded",
      );
    }
  }

  private handleGradingErrors(errors: string[], warnings: string[]): void {
    for (const error of errors) {
      this.logger.error(`Grading error: ${error}`);
    }

    for (const warning of warnings) {
      this.logger.warn(`Grading warning: ${warning}`);
    }
  }

  private logSystemHealth(health: {
    totalRequests: number;
    successRate: number;
    averageProcessingTime: number;
    errorRate: number;
    circuitBreakerStatus: Record<string, boolean>;
    fallbackUsageRate: number;
    lastHealthCheck: number;
  }): void {
    this.logger.log("System health status", {
      requests: health.totalRequests,
      successRate: `${(health.successRate * 100).toFixed(1)}%`,
      avgProcessingTime: `${health.averageProcessingTime}ms`,
      errorRate: `${(health.errorRate * 100).toFixed(2)}%`,
      fallbackRate: `${(health.fallbackUsageRate * 100).toFixed(2)}%`,
      circuitBreakers: Object.keys(health.circuitBreakerStatus).filter(
        (key) => health.circuitBreakerStatus[key],
      ),
    });
  }

  async demonstrateBatchProcessing(): Promise<void> {
    const batchContexts: GradingContextData[] = [
      {
        questionId: "batch_001",
        learnerAnswer:
          "Water cycle involves evaporation, condensation, and precipitation.",
        rubric: [
          {
            id: "understanding",
            description: "Demonstrates understanding of water cycle",
            maxPoints: 10,
          },
        ],
        questionType: "TEXT",
        timeout: 30_000,
        maxRetries: 1,
      },
      {
        questionId: "batch_002",
        learnerAnswer: "True, because the Earth revolves around the Sun.",
        rubric: [
          {
            id: "correctness",
            description: "Answer is factually correct",
            maxPoints: 5,
          },
        ],
        questionType: "TRUE_FALSE",
        timeout: 15_000,
        maxRetries: 1,
      },
    ];

    try {
      const results =
        await this.gradingService.processGradingBatch(batchContexts);
      const stats = this.gradingService.getProcessingStats(results);

      this.logger.log("Batch processing completed", {
        totalRequests: results.length,
        successRate: (stats.successRate * 100).toFixed(1) + "%",
        avgProcessingTime: stats.avgProcessingTimeMs.toFixed(0) + "ms",
        riskDistribution: stats.riskDistribution,
        fallbackRate: (stats.fallbackRate * 100).toFixed(1) + "%",
      });
    } catch (error) {
      this.logger.error("Batch processing failed:", error);
    }
  }

  demonstrateAdvancedMetrics(): void {
    // Get detailed metrics with time window
    const metrics = this.gradingService.getMetrics(3_600_000); // Last hour

    this.logger.log("Advanced metrics analysis", {
      requestCount: metrics.requestCount,
      successRate: (metrics.successRate * 100).toFixed(1) + "%",
      avgProcessingTime: metrics.averageProcessingTime.toFixed(0) + "ms",
      llmUsage: {
        totalCalls: metrics.llmUsage.totalCalls,
        totalTokens: metrics.llmUsage.totalTokens,
        avgTokensPerCall: metrics.llmUsage.avgTokensPerCall.toFixed(0),
      },
      nodePerformance: Object.entries(metrics.nodePerformance).map(
        ([node, perf]) => ({
          node,
          avgTime: perf.avgTime.toFixed(0) + "ms",
          successRate: (perf.successRate * 100).toFixed(1) + "%",
        }),
      ),
      fallbackUsage: {
        count: metrics.fallbackUsage.count,
        rate: (metrics.fallbackUsage.rate * 100).toFixed(1) + "%",
      },
      errorAnalysis: metrics.errorAnalysis,
    });
  }
}

// Example usage with proper error handling
export async function runTypeSafeGradingExample(
  gradingService: EnhancedAutomatedGradingService,
  monitoringService: MonitoringService,
): Promise<void> {
  const example = new TypeSafeGradingExample(gradingService, monitoringService);

  try {
    await example.demonstrateTypeSafeGrading();
    await example.demonstrateBatchProcessing();
    example.demonstrateAdvancedMetrics();
  } catch (error) {
    console.error("Example execution failed:", error);
  }
}
