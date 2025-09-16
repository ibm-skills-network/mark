import { Injectable, Logger } from "@nestjs/common";
import {
  ErrorRecoveryData,
  FinalGradeData,
  GradingContextData,
} from "../types/grading.types";

interface GradingMetrics {
  requestId: string;
  timestamp: number;
  context: Partial<GradingContextData>;
  processingSteps: string[];
  nodeExecutionTimes: Record<string, number>;
  totalProcessingTime: number;
  llmCalls: number;
  llmTokensUsed: number;
  cacheHits: number;
  memoryUsage?: number;
  errorCount: number;
  circuitBreakerTriggered: boolean;
  fallbackUsed: boolean;
  finalGrade?: Partial<FinalGradeData>;
  errorRecovery: ErrorRecoveryData;
}

export interface SystemHealth {
  totalRequests: number;
  successRate: number;
  averageProcessingTime: number;
  errorRate: number;
  circuitBreakerStatus: Record<string, boolean>;
  fallbackUsageRate: number;
  memoryUsage?: number;
  lastHealthCheck: number;
}

interface AlertThresholds {
  maxErrorRate: number;
  maxProcessingTime: number;
  maxMemoryUsage?: number;
  minSuccessRate: number;
  maxConcurrentRequests: number;
}

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);
  private metrics: Map<string, GradingMetrics> = new Map();
  private systemHealth: SystemHealth = {
    totalRequests: 0,
    successRate: 1,
    averageProcessingTime: 0,
    errorRate: 0,
    circuitBreakerStatus: {},
    fallbackUsageRate: 0,
    lastHealthCheck: Date.now(),
  };
  private alertThresholds: AlertThresholds = {
    maxErrorRate: 0.1,
    maxProcessingTime: 120_000,
    minSuccessRate: 0.9,
    maxConcurrentRequests: 100,
  };
  private concurrentRequests = 0;
  private readonly maxMetricsRetention = 10_000;
  private readonly healthCheckInterval = 30_000;

  constructor() {
    this.startHealthCheckTimer();
  }

  startGradingRequest(requestId: string, context: GradingContextData): void {
    this.concurrentRequests++;

    const metrics: GradingMetrics = {
      requestId,
      timestamp: Date.now(),
      context: {
        questionId: context.questionId,
        questionType: context.questionType,
        responseType: context.responseType,
      },
      processingSteps: [],
      nodeExecutionTimes: {},
      totalProcessingTime: 0,
      llmCalls: 0,
      llmTokensUsed: 0,
      cacheHits: 0,
      errorCount: 0,
      circuitBreakerTriggered: false,
      fallbackUsed: false,
      errorRecovery: {
        attempts: 0,
        recoveryStrategy: "retry",
        fallbackUsed: false,
      },
    };

    this.metrics.set(requestId, metrics);
    this.systemHealth.totalRequests++;

    this.logger.debug(`Started monitoring request ${requestId}`);

    if (this.concurrentRequests > this.alertThresholds.maxConcurrentRequests) {
      this.triggerAlert(
        "HIGH_CONCURRENCY",
        `Concurrent requests: ${this.concurrentRequests}`,
      );
    }
  }

  recordNodeExecution(
    requestId: string,
    nodeName: string,
    executionTime: number,
    success: boolean,
    llmTokens?: number,
  ): void {
    const metrics = this.metrics.get(requestId);
    if (!metrics) {
      this.logger.warn(`No metrics found for request ${requestId}`);
      return;
    }

    metrics.processingSteps.push(nodeName);
    metrics.nodeExecutionTimes[nodeName] = executionTime;

    if (llmTokens) {
      metrics.llmCalls++;
      metrics.llmTokensUsed += llmTokens;
    }

    if (!success) {
      metrics.errorCount++;
    }

    this.logger.debug(
      `Node ${nodeName} executed for ${requestId} in ${executionTime}ms, success: ${success.toString()}`,
    );
  }

  recordCircuitBreakerTriggered(requestId: string, nodeName: string): void {
    const metrics = this.metrics.get(requestId);
    if (metrics) {
      metrics.circuitBreakerTriggered = true;
    }

    this.systemHealth.circuitBreakerStatus[nodeName] = true;

    this.logger.warn(
      `Circuit breaker triggered for ${nodeName} in request ${requestId}`,
    );
    this.triggerAlert(
      "CIRCUIT_BREAKER",
      `Circuit breaker opened for ${nodeName}`,
    );
  }

  recordFallbackUsed(requestId: string, fallbackType: string): void {
    const metrics = this.metrics.get(requestId);
    if (metrics) {
      metrics.fallbackUsed = true;
      metrics.errorRecovery.fallbackUsed = true;
    }

    this.logger.log(`Fallback ${fallbackType} used for request ${requestId}`);
  }

  recordCacheHit(requestId: string): void {
    const metrics = this.metrics.get(requestId);
    if (metrics) {
      metrics.cacheHits++;
    }
  }

  recordMemoryUsage(requestId: string, memoryUsage: number): void {
    const metrics = this.metrics.get(requestId);
    if (metrics) {
      metrics.memoryUsage = memoryUsage;
    }

    if (
      this.alertThresholds.maxMemoryUsage &&
      memoryUsage > this.alertThresholds.maxMemoryUsage
    ) {
      this.triggerAlert("HIGH_MEMORY_USAGE", `Memory usage: ${memoryUsage} MB`);
    }
  }

  completeGradingRequest(
    requestId: string,
    success: boolean,
    finalGrade?: FinalGradeData,
    errorRecovery?: ErrorRecoveryData,
  ): void {
    const metrics = this.metrics.get(requestId);
    if (!metrics) {
      this.logger.warn(`No metrics found for completing request ${requestId}`);
      return;
    }

    this.concurrentRequests = Math.max(0, this.concurrentRequests - 1);

    const totalTime = Date.now() - metrics.timestamp;
    metrics.totalProcessingTime = totalTime;
    metrics.finalGrade = finalGrade
      ? {
          selectedSource: finalGrade.selectedSource,
          reasoning: finalGrade.reasoning,
          processingSteps: finalGrade.processingSteps,
        }
      : undefined;

    if (errorRecovery) {
      metrics.errorRecovery = errorRecovery;
    }

    this.updateSystemHealth();
    this.logCompletionMetrics(requestId, metrics, success);

    if (totalTime > this.alertThresholds.maxProcessingTime) {
      this.triggerAlert(
        "SLOW_PROCESSING",
        `Request ${requestId} took ${totalTime}ms`,
      );
    }

    if (metrics.errorCount > 5) {
      this.triggerAlert(
        "HIGH_ERROR_COUNT",
        `Request ${requestId} had ${metrics.errorCount} errors`,
      );
    }

    this.cleanupOldMetrics();
  }

  getRequestMetrics(requestId: string): GradingMetrics | undefined {
    return this.metrics.get(requestId);
  }

  getSystemHealth(): SystemHealth {
    return { ...this.systemHealth };
  }

  getAggregatedMetrics(timeWindowMs = 3_600_000): {
    requestCount: number;
    averageProcessingTime: number;
    successRate: number;
    nodePerformance: Record<string, { avgTime: number; successRate: number }>;
    llmUsage: {
      totalCalls: number;
      totalTokens: number;
      avgTokensPerCall: number;
    };
    fallbackUsage: { count: number; rate: number };
    errorAnalysis: Record<string, number>;
  } {
    const cutoff = Date.now() - timeWindowMs;
    const recentMetrics = [...this.metrics.values()].filter(
      (m) => m.timestamp > cutoff,
    );

    if (recentMetrics.length === 0) {
      return {
        requestCount: 0,
        averageProcessingTime: 0,
        successRate: 1,
        nodePerformance: {},
        llmUsage: { totalCalls: 0, totalTokens: 0, avgTokensPerCall: 0 },
        fallbackUsage: { count: 0, rate: 0 },
        errorAnalysis: {},
      };
    }

    const requestCount = recentMetrics.length;
    const successfulRequests = recentMetrics.filter((m) => m.finalGrade).length;
    const successRate =
      requestCount > 0 ? successfulRequests / requestCount : 1;

    const totalProcessingTime = recentMetrics.reduce(
      (sum, m) => sum + m.totalProcessingTime,
      0,
    );
    const averageProcessingTime = totalProcessingTime / requestCount;

    const nodePerformance: Record<
      string,
      { avgTime: number; successRate: number }
    > = {};
    const nodeStats: Record<
      string,
      { totalTime: number; count: number; successes: number }
    > = {};

    for (const metrics of recentMetrics) {
      for (const [node, time] of Object.entries(metrics.nodeExecutionTimes)) {
        if (!nodeStats[node]) {
          nodeStats[node] = { totalTime: 0, count: 0, successes: 0 };
        }
        nodeStats[node].totalTime += time;
        nodeStats[node].count++;
        if (metrics.finalGrade) nodeStats[node].successes++;
      }
    }

    for (const [node, stats] of Object.entries(nodeStats)) {
      nodePerformance[node] = {
        avgTime: stats.totalTime / stats.count,
        successRate: stats.successes / stats.count,
      };
    }

    const totalLLMCalls = recentMetrics.reduce((sum, m) => sum + m.llmCalls, 0);
    const totalTokens = recentMetrics.reduce(
      (sum, m) => sum + m.llmTokensUsed,
      0,
    );
    const avgTokensPerCall =
      totalLLMCalls > 0 ? totalTokens / totalLLMCalls : 0;

    const fallbackCount = recentMetrics.filter((m) => m.fallbackUsed).length;
    const fallbackRate = requestCount > 0 ? fallbackCount / requestCount : 0;

    const errorAnalysis: Record<string, number> = {};
    for (const metrics of recentMetrics) {
      if (metrics.errorCount > 0) {
        for (const step of metrics.processingSteps) {
          errorAnalysis[step] = (errorAnalysis[step] || 0) + 1;
        }
      }
    }

    return {
      requestCount,
      averageProcessingTime,
      successRate,
      nodePerformance,
      llmUsage: { totalCalls: totalLLMCalls, totalTokens, avgTokensPerCall },
      fallbackUsage: { count: fallbackCount, rate: fallbackRate },
      errorAnalysis,
    };
  }

  private updateSystemHealth(): void {
    const recentMetrics = [...this.metrics.values()]
      .filter((m) => Date.now() - m.timestamp < 300_000)
      .slice(-1000);

    if (recentMetrics.length > 0) {
      const successCount = recentMetrics.filter((m) => m.finalGrade).length;
      this.systemHealth.successRate = successCount / recentMetrics.length;

      const totalTime = recentMetrics.reduce(
        (sum, m) => sum + m.totalProcessingTime,
        0,
      );
      this.systemHealth.averageProcessingTime =
        totalTime / recentMetrics.length;

      const errorCount = recentMetrics.reduce(
        (sum, m) => sum + (m.errorCount > 0 ? 1 : 0),
        0,
      );
      this.systemHealth.errorRate = errorCount / recentMetrics.length;

      const fallbackCount = recentMetrics.filter((m) => m.fallbackUsed).length;
      this.systemHealth.fallbackUsageRate =
        fallbackCount / recentMetrics.length;
    }

    this.systemHealth.lastHealthCheck = Date.now();
  }

  private logCompletionMetrics(
    requestId: string,
    metrics: GradingMetrics,
    success: boolean,
  ): void {
    const logData = {
      requestId,
      success,
      totalTime: metrics.totalProcessingTime,
      nodeExecutionTimes: metrics.nodeExecutionTimes,
      llmCalls: metrics.llmCalls,
      tokensUsed: metrics.llmTokensUsed,
      errorCount: metrics.errorCount,
      fallbackUsed: metrics.fallbackUsed,
      circuitBreakerTriggered: metrics.circuitBreakerTriggered,
      finalSource: metrics.finalGrade?.selectedSource,
    };

    if (success) {
      this.logger.log(`Request ${requestId} completed successfully`, logData);
    } else {
      this.logger.error(`Request ${requestId} failed`, logData);
    }
  }

  private cleanupOldMetrics(): void {
    if (this.metrics.size > this.maxMetricsRetention) {
      const sortedMetrics = [...this.metrics.entries()].sort(
        (a, b) => b[1].timestamp - a[1].timestamp,
      );

      const toDelete = sortedMetrics.slice(this.maxMetricsRetention);
      for (const [requestId] of toDelete) {
        this.metrics.delete(requestId);
      }

      this.logger.debug(`Cleaned up ${toDelete.length} old metrics entries`);
    }
  }

  private startHealthCheckTimer(): void {
    setInterval(() => {
      this.performHealthCheck();
    }, this.healthCheckInterval);
  }

  private performHealthCheck(): void {
    const health = this.getSystemHealth();

    if (health.successRate < this.alertThresholds.minSuccessRate) {
      this.triggerAlert(
        "LOW_SUCCESS_RATE",
        `Success rate: ${health.successRate.toFixed(3)}`,
      );
    }

    if (health.errorRate > this.alertThresholds.maxErrorRate) {
      this.triggerAlert(
        "HIGH_ERROR_RATE",
        `Error rate: ${health.errorRate.toFixed(3)}`,
      );
    }

    if (health.averageProcessingTime > this.alertThresholds.maxProcessingTime) {
      this.triggerAlert(
        "SLOW_AVERAGE_PROCESSING",
        `Avg time: ${health.averageProcessingTime}ms`,
      );
    }

    this.logger.debug("Health check completed", {
      successRate: health.successRate,
      errorRate: health.errorRate,
      avgProcessingTime: health.averageProcessingTime,
      concurrentRequests: this.concurrentRequests,
    });
  }

  private triggerAlert(alertType: string, message: string): void {
    this.logger.warn(`ALERT [${alertType}]: ${message}`);
  }

  updateAlertThresholds(newThresholds: Partial<AlertThresholds>): void {
    this.alertThresholds = { ...this.alertThresholds, ...newThresholds };
    this.logger.log("Alert thresholds updated", this.alertThresholds);
  }

  resetMetrics(): void {
    this.metrics.clear();
    this.systemHealth = {
      totalRequests: 0,
      successRate: 1,
      averageProcessingTime: 0,
      errorRate: 0,
      circuitBreakerStatus: {},
      fallbackUsageRate: 0,
      lastHealthCheck: Date.now(),
    };
    this.logger.log("Metrics reset");
  }
}
