import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { v4 as uuidv4 } from "uuid";
import { GradingGraph } from "../graph/grade.graph";
import { GradingGraphState, initialState } from "../graph/state";
import { CompareNode } from "../nodes/compare.node";
import { DecisionNode } from "../nodes/decision.node";
import { EnhancedGradeNode } from "../nodes/enhanced-grade.node";
import { EnhancedValidateNode } from "../nodes/enhanced-validate.node";
import { EvidenceNode } from "../nodes/evidence.node";
import { JudgeNode } from "../nodes/judge.node";
import { FinalGradeData, GradingContextData } from "../types/grading.types";
import { EnhancedPolicyService } from "./enhanced-policy.service";
import { EvidenceService } from "./evidence.service";
import { MetaDeciderService } from "./meta-decider.service";
import { MonitoringService, SystemHealth } from "./monitoring.service";

interface GradingResult {
  requestId: string;
  success: boolean;
  finalGrade?: FinalGradeData;
  errors: string[];
  warnings: string[];
  processingTimeMs: number;
  riskLevel: "low" | "medium" | "high";
  fallbackUsed: boolean;
  debugInfo?: {
    processingSteps?: string[];
    nodeExecutionTimes?: Record<string, number>;
    errorRecovery?: any;
    circuitBreakerStatus?: Record<string, any>;
  };
}

interface GradingServiceConfig {
  maxConcurrentRequests: number;
  enableBatching: boolean;
  batchSize: number;
  batchTimeoutMs: number;
  enableDebugMode: boolean;
  enableCaching: boolean;
  defaultTimeout: number;
  enableFailfast: boolean;
}

@Injectable()
export class EnhancedAutomatedGradingService implements OnModuleDestroy {
  private readonly logger = new Logger(EnhancedAutomatedGradingService.name);
  private graph: GradingGraph | null = null;
  private readonly config: GradingServiceConfig;
  private readonly activeRequests = new Map<string, Promise<GradingResult>>();
  private readonly requestQueue: Array<{
    context: GradingContextData;
    resolve: (result: GradingResult) => void;
    reject: (error: Error) => void;
    timestamp: number;
  }> = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private shutdownRequested = false;

  constructor(
    private enhancedGradeNode: EnhancedGradeNode,
    private enhancedValidateNode: EnhancedValidateNode,
    private judgeNode: JudgeNode,
    private evidenceNode: EvidenceNode,
    private compareNode: CompareNode,
    private decisionNode: DecisionNode,
    private enhancedPolicyService: EnhancedPolicyService,
    private evidenceService: EvidenceService,
    private metaDeciderService: MetaDeciderService,
    private monitoringService: MonitoringService,
    config?: Partial<GradingServiceConfig>,
  ) {
    this.config = {
      maxConcurrentRequests: 50,
      enableBatching: true,
      batchSize: 10,
      batchTimeoutMs: 5000,
      enableDebugMode: false,
      enableCaching: true,
      defaultTimeout: 120_000,
      enableFailfast: true,
      ...config,
    };

    this.initializeGraph();
    this.logger.log(
      "Enhanced Automated Grading Service initialized",
      this.config,
    );
  }

  async executeGradingPipeline(
    context: GradingContextData,
  ): Promise<GradingResult> {
    if (this.shutdownRequested) {
      throw new Error("Service is shutting down, cannot process new requests");
    }

    const requestId = uuidv4();

    try {
      if (this.activeRequests.size >= this.config.maxConcurrentRequests) {
        if (this.config.enableFailfast) {
          throw new Error("Maximum concurrent requests exceeded");
        }

        if (this.config.enableBatching) {
          return this.queueForBatch(context);
        }
      }

      const resultPromise = this.processGradingRequest(requestId, context);
      this.activeRequests.set(requestId, resultPromise);

      try {
        const result = await resultPromise;
        return result;
      } finally {
        this.activeRequests.delete(requestId);
      }
    } catch (error) {
      this.activeRequests.delete(requestId);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      this.logger.error(
        `Failed to execute grading pipeline for ${requestId}:`,
        error,
      );

      return {
        requestId,
        success: false,
        errors: [errorMessage],
        warnings: [],
        processingTimeMs: 0,
        riskLevel: "high",
        fallbackUsed: false,
      };
    }
  }

  private async processGradingRequest(
    requestId: string,
    context: GradingContextData,
  ): Promise<GradingResult> {
    const startTime = Date.now();

    try {
      this.monitoringService.startGradingRequest(requestId, context);

      const validatedContext = await this.validateAndSanitizeContext(context);

      if (this.shouldEarlyExit(validatedContext)) {
        return this.executeSimpleGrading(
          requestId,
          validatedContext,
          startTime,
        );
      }

      return this.executeFullGrading(requestId, validatedContext, startTime);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown processing error";

      const result: GradingResult = {
        requestId,
        success: false,
        errors: [`Pipeline execution failed: ${errorMessage}`],
        warnings: [],
        processingTimeMs: Date.now() - startTime,
        riskLevel: "high",
        fallbackUsed: false,
      };

      this.monitoringService.completeGradingRequest(
        requestId,
        false,
        undefined,
        {
          attempts: 1,
          lastError: errorMessage,
          recoveryStrategy: "abort",
          fallbackUsed: false,
        },
      );

      return result;
    }
  }

  private async validateAndSanitizeContext(
    context: GradingContextData,
  ): Promise<GradingContextData> {
    const sanitized = { ...context };

    if (sanitized.learnerAnswer.length > 50_000) {
      sanitized.learnerAnswer =
        sanitized.learnerAnswer.slice(0, 47_000) +
        "... [truncated for processing]";
      this.logger.warn("Answer truncated due to length");
    }

    if (sanitized.rubric.length > 20) {
      sanitized.rubric = sanitized.rubric.slice(0, 20);
      this.logger.warn("Rubric truncated to 20 criteria");
    }

    sanitized.rubric = sanitized.rubric.filter(
      (criterion) =>
        criterion.maxPoints > 0 && criterion.description.length > 0,
    );

    if (sanitized.rubric.length === 0) {
      throw new Error("No valid rubric criteria found");
    }

    return sanitized;
  }

  private shouldEarlyExit(context: GradingContextData): boolean {
    return (
      ["TRUE_FALSE", "SINGLE_CORRECT", "MULTIPLE_CORRECT"].includes(
        context.questionType,
      ) &&
      context.rubric.length <= 5 &&
      context.learnerAnswer.length < 1000
    );
  }

  private async executeSimpleGrading(
    requestId: string,
    context: GradingContextData,
    startTime: number,
  ): Promise<GradingResult> {
    const state = initialState(context);
    const warnings: string[] = [];

    try {
      let currentState = await this.executeNodeWithRecovery(
        requestId,
        "grade",
        () => this.enhancedGradeNode.execute(state),
      );

      currentState = await this.executeNodeWithRecovery(
        requestId,
        "validate",
        () => this.enhancedValidateNode.execute(currentState),
      );

      currentState = await this.executeNodeWithRecovery(
        requestId,
        "evidence",
        () => this.evidenceNode.execute(currentState),
      );

      if (
        this.enhancedPolicyService.shouldEarlyExit(
          currentState.graderResult,
          currentState.evidenceVerification,
          currentState.context.questionType,
          {
            questionType: context.questionType,
            fallbackUsed: currentState.fallback_used,
            errorCount: currentState.errors.length,
          },
        )
      ) {
        currentState = await this.executeNodeWithRecovery(
          requestId,
          "decision",
          () => this.decisionNode.execute(currentState),
        );

        const result: GradingResult = {
          requestId,
          success: true,
          finalGrade: currentState.finalGrade,
          errors: currentState.errors,
          warnings: [...warnings, "Early exit processing used"],
          processingTimeMs: Date.now() - startTime,
          riskLevel: currentState.fallback_used ? "medium" : "low",
          fallbackUsed: currentState.fallback_used,
          debugInfo: this.config.enableDebugMode
            ? {
                processingSteps: currentState.finalGrade?.processingSteps,
                nodeExecutionTimes:
                  currentState.processing_metrics.nodeExecutionTimes,
              }
            : undefined,
        };

        this.monitoringService.completeGradingRequest(
          requestId,
          true,
          currentState.finalGrade,
          currentState.error_recovery,
        );

        return result;
      }

      return this.executeFullGrading(
        requestId,
        context,
        startTime,
        currentState,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Simple grading failed";

      const result: GradingResult = {
        requestId,
        success: false,
        errors: [errorMessage],
        warnings,
        processingTimeMs: Date.now() - startTime,
        riskLevel: "high",
        fallbackUsed: false,
      };

      this.monitoringService.completeGradingRequest(requestId, false);
      return result;
    }
  }

  private async executeFullGrading(
    requestId: string,
    context: GradingContextData,
    startTime: number,
    initialStateOverride?: GradingGraphState,
  ): Promise<GradingResult> {
    try {
      if (!this.graph) {
        throw new Error("Graph not initialized");
      }

      const state = initialStateOverride || initialState(context);
      const compiledGraph = this.graph.compile();

      const result = await Promise.race([
        compiledGraph.invoke(state),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Pipeline timeout")),
            context.timeout || this.config.defaultTimeout,
          ),
        ),
      ]);

      const warnings: string[] = [];

      if (result.errors.length > 0) {
        warnings.push(
          `${result.errors.length} errors occurred during processing`,
        );
      }

      if (result.fallback_used) {
        warnings.push("Fallback mechanisms were used");
      }

      const gradingResult: GradingResult = {
        requestId,
        success: result.finalGrade !== undefined,
        finalGrade: result.finalGrade,
        errors: result.errors,
        warnings,
        processingTimeMs: Date.now() - startTime,
        riskLevel: this.assessOverallRisk(result),
        fallbackUsed: result.fallback_used,
        debugInfo: this.config.enableDebugMode
          ? {
              processingSteps: result.finalGrade?.processingSteps,
              nodeExecutionTimes: result.processing_metrics.nodeExecutionTimes,
              errorRecovery: result.error_recovery,
              circuitBreakerStatus: result.node_circuit_breakers,
            }
          : undefined,
      };

      this.monitoringService.completeGradingRequest(
        requestId,
        gradingResult.success,
        result.finalGrade,
        result.error_recovery,
      );

      return gradingResult;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Full grading pipeline failed";

      const result: GradingResult = {
        requestId,
        success: false,
        errors: [errorMessage],
        warnings: [],
        processingTimeMs: Date.now() - startTime,
        riskLevel: "high",
        fallbackUsed: false,
      };

      this.monitoringService.completeGradingRequest(requestId, false);
      return result;
    }
  }

  private async executeNodeWithRecovery<T>(
    requestId: string,
    nodeName: string,
    nodeExecution: () => Promise<T>,
  ): Promise<T> {
    const startTime = Date.now();

    try {
      const result = await nodeExecution();
      const executionTime = Date.now() - startTime;

      this.monitoringService.recordNodeExecution(
        requestId,
        nodeName,
        executionTime,
        true,
      );
      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.monitoringService.recordNodeExecution(
        requestId,
        nodeName,
        executionTime,
        false,
      );

      this.logger.error(
        `Node ${nodeName} failed for request ${requestId}:`,
        error,
      );
      throw error;
    }
  }

  private assessOverallRisk(
    state: GradingGraphState,
  ): "low" | "medium" | "high" {
    if (state.errors.length > 5 || state.error_recovery.attempts > 5) {
      return "high";
    }

    if (state.fallback_used || state.errors.length > 0) {
      return "medium";
    }

    const confidence = state.finalGrade?.grade?.confidence || 0;
    if (confidence < 0.7) {
      return "medium";
    }

    return "low";
  }

  private async queueForBatch(
    context: GradingContextData,
  ): Promise<GradingResult> {
    return new Promise<GradingResult>((resolve, reject) => {
      this.requestQueue.push({
        context,
        resolve,
        reject,
        timestamp: Date.now(),
      });

      if (this.requestQueue.length >= this.config.batchSize) {
        void this.processBatch();
      } else if (!this.batchTimer) {
        this.batchTimer = setTimeout(
          () => void this.processBatch(),
          this.config.batchTimeoutMs,
        );
      }
    });
  }

  private async processBatch(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    const batch = this.requestQueue.splice(0, this.config.batchSize);
    if (batch.length === 0) return;

    this.logger.debug(`Processing batch of ${batch.length} requests`);

    const results = await Promise.allSettled(
      batch.map(({ context }) => this.executeGradingPipeline(context)),
    );

    for (const [index, result] of results.entries()) {
      const { resolve, reject } = batch[index];

      if (result.status === "fulfilled") {
        resolve(result.value);
      } else {
        reject(result.reason as Error);
      }
    }
  }

  async processGradingBatch(
    contexts: GradingContextData[],
  ): Promise<GradingResult[]> {
    if (this.shutdownRequested) {
      throw new Error("Service is shutting down");
    }

    this.logger.log(`Processing batch of ${contexts.length} grading requests`);

    const results = await Promise.allSettled(
      contexts.map((context) => this.executeGradingPipeline(context)),
    );

    return results.map((result) => {
      if (result.status === "fulfilled") {
        return result.value;
      } else {
        const errorMessage =
          result.reason instanceof Error
            ? result.reason.message
            : "Unknown batch error";
        return {
          requestId: uuidv4(),
          success: false,
          errors: [`Batch processing failed: ${errorMessage}`],
          warnings: [],
          processingTimeMs: 0,
          riskLevel: "high" as const,
          fallbackUsed: false,
        };
      }
    });
  }

  getProcessingStats(results: GradingResult[]): {
    successRate: number;
    avgProcessingTimeMs: number;
    totalErrors: number;
    riskDistribution: Record<string, number>;
    fallbackRate: number;
  } {
    const successful = results.filter((r) => r.success);
    const riskDistribution = { low: 0, medium: 0, high: 0 };

    for (const r of results) riskDistribution[r.riskLevel]++;

    return {
      successRate: successful.length / results.length,
      avgProcessingTimeMs:
        results.reduce((sum, r) => sum + r.processingTimeMs, 0) /
        results.length,
      totalErrors: results.reduce((sum, r) => sum + r.errors.length, 0),
      riskDistribution,
      fallbackRate:
        results.filter((r) => r.fallbackUsed).length / results.length,
    };
  }

  getSystemHealth(): SystemHealth {
    return this.monitoringService.getSystemHealth();
  }

  getMetrics(timeWindowMs?: number) {
    return this.monitoringService.getAggregatedMetrics(timeWindowMs);
  }

  private initializeGraph(): void {
    try {
      this.graph = new GradingGraph(
        (state) => this.enhancedGradeNode.execute(state),
        (state) => this.enhancedValidateNode.execute(state),
        (state) => this.judgeNode.executeJudgeA(state),
        (state) => this.evidenceNode.execute(state),
        (state) => this.compareNode.execute(state),
        (state) => this.decisionNode.execute(state),
      );

      this.logger.log("Grading graph initialized successfully");
    } catch (error) {
      this.logger.error("Failed to initialize grading graph:", error);
      throw new Error("Graph initialization failed");
    }
  }

  async gracefulShutdown(): Promise<void> {
    this.logger.log("Starting graceful shutdown...");
    this.shutdownRequested = true;

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      await this.processBatch();
    }

    await Promise.allSettled(this.activeRequests.values());

    for (const { reject } of this.requestQueue) {
      reject(new Error("Service shutdown"));
    }
    this.requestQueue.length = 0;

    this.logger.log("Graceful shutdown completed");
  }

  onModuleDestroy(): void {
    this.gracefulShutdown().catch((error) => {
      this.logger.error("Error during shutdown:", error);
    });
  }
}
