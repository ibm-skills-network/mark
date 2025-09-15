import { Inject, Injectable, Logger } from "@nestjs/common";
import { LLM_ASSIGNMENT_SERVICE } from "../../llm.constants";
import { LLMAssignmentService } from "./llm-assignment.service";

export interface TaskComplexityContext {
  featureKey: string;
  inputLength?: number;
  responseType?: string;
  requiresReasoning?: boolean;
  hasMultipleCriteria?: boolean;
  isValidationOnly?: boolean;
  customComplexity?: "simple" | "complex";
}

export type TaskComplexity = "simple" | "complex";

/**
 * Service to resolve which LLM model should be used for different features
 */
@Injectable()
export class LLMResolverService {
  private readonly logger = new Logger(LLMResolverService.name);
  private readonly modelCache = new Map<
    string,
    { modelKey: string; cachedAt: number }
  >();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

  constructor(
    @Inject(LLM_ASSIGNMENT_SERVICE)
    private readonly assignmentService: LLMAssignmentService,
  ) {}

  /**
   * Get the model key that should be used for a specific feature
   * This method includes caching for performance
   */
  async resolveModelForFeature(featureKey: string): Promise<string | null> {
    // Check cache first
    const cached = this.modelCache.get(featureKey);
    if (cached && Date.now() - cached.cachedAt < this.CACHE_TTL) {
      this.logger.debug(
        `Using cached model ${cached.modelKey} for feature ${featureKey}`,
      );
      return cached.modelKey;
    }

    try {
      // Get assigned model from service
      const modelKey =
        await this.assignmentService.getAssignedModel(featureKey);

      if (modelKey) {
        // Cache the result
        this.modelCache.set(featureKey, {
          modelKey,
          cachedAt: Date.now(),
        });

        this.logger.debug(
          `Resolved model ${modelKey} for feature ${featureKey}`,
        );
        return modelKey;
      }

      this.logger.warn(`No model resolved for feature ${featureKey}`);
      return null;
    } catch (error) {
      this.logger.error(
        `Failed to resolve model for feature ${featureKey}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Get models for multiple features at once
   */
  async resolveModelsForFeatures(
    featureKeys: string[],
  ): Promise<Map<string, string | null>> {
    const results = new Map<string, string | null>();

    // Process all features in parallel
    const promises = featureKeys.map(async (featureKey) => {
      const modelKey = await this.resolveModelForFeature(featureKey);
      return { featureKey, modelKey };
    });

    const resolved = await Promise.all(promises);
    for (const { featureKey, modelKey } of resolved) {
      results.set(featureKey, modelKey);
    }

    return results;
  }

  /**
   * Clear cache for a specific feature (useful when assignments change)
   */
  clearCacheForFeature(featureKey: string): void {
    this.modelCache.delete(featureKey);
    this.logger.debug(`Cleared cache for feature ${featureKey}`);
  }

  /**
   * Clear all cached model assignments
   */
  clearAllCache(): void {
    this.modelCache.clear();
    this.logger.debug("Cleared all model assignment cache");
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    const now = Date.now();
    let validEntries = 0;
    let expiredEntries = 0;

    for (const [, entry] of this.modelCache) {
      if (now - entry.cachedAt < this.CACHE_TTL) {
        validEntries++;
      } else {
        expiredEntries++;
      }
    }

    return {
      totalEntries: this.modelCache.size,
      validEntries,
      expiredEntries,
      cacheTtlMs: this.CACHE_TTL,
    };
  }

  /**
   * Convenience method to get model key with fallback
   */
  async getModelKeyWithFallback(
    featureKey: string,
    fallbackModel = "gpt-4o-mini",
  ): Promise<string> {
    const resolvedModel = await this.resolveModelForFeature(featureKey);

    if (resolvedModel) {
      return resolvedModel;
    }

    this.logger.warn(
      `Using fallback model ${fallbackModel} for feature ${featureKey}`,
    );
    return fallbackModel;
  }

  /**
   * Get model based on task complexity analysis
   */
  async getModelForComplexity(context: TaskComplexityContext): Promise<string> {
    // First try to get specifically assigned model
    const assignedModel = await this.resolveModelForFeature(context.featureKey);
    if (assignedModel) {
      this.logger.debug(
        `Using assigned model ${assignedModel} for feature ${context.featureKey}`,
      );
      return assignedModel;
    }

    // Analyze task complexity and select appropriate model
    const complexity = this.analyzeTaskComplexity(context);
    const selectedModel = this.selectModelForComplexity(complexity);

    this.logger.debug(
      `Selected ${selectedModel} model based on ${complexity} complexity for feature ${context.featureKey}`,
    );
    return selectedModel;
  }

  /**
   * Analyze task complexity based on context
   */
  private analyzeTaskComplexity(
    context: TaskComplexityContext,
  ): TaskComplexity {
    // Use custom complexity if provided
    if (context.customComplexity) {
      return context.customComplexity;
    }

    // Define simple task patterns
    const simpleTaskPatterns = [
      "validation",
      "judge",
      "math_check",
      "format_check",
      "sanitization",
      "basic_feedback",
    ];

    const complexTaskPatterns = [
      "grading",
      "generation",
      "analysis",
      "evaluation",
      "reasoning",
      "feedback",
      "translation",
    ];

    // Check for validation-only tasks (always simple)
    if (context.isValidationOnly) {
      return "simple";
    }

    // Check feature key patterns
    const featureKey = context.featureKey.toLowerCase();

    if (simpleTaskPatterns.some((pattern) => featureKey.includes(pattern))) {
      return "simple";
    }

    if (complexTaskPatterns.some((pattern) => featureKey.includes(pattern))) {
      return "complex";
    }

    // Analyze based on context characteristics
    let complexityScore = 0;

    // Input length factor
    if (context.inputLength) {
      if (context.inputLength > 10_000)
        complexityScore += 2; // Large input = complex
      else if (context.inputLength > 2000) complexityScore += 1;
    }

    // Reasoning requirement
    if (context.requiresReasoning) complexityScore += 2;

    // Multiple criteria evaluation
    if (context.hasMultipleCriteria) complexityScore += 1;

    // Response type complexity
    if (context.responseType) {
      const complexResponseTypes = [
        "CODE",
        "ESSAY",
        "REPORT",
        "PRESENTATION",
        "VIDEO",
      ];
      if (complexResponseTypes.includes(context.responseType.toUpperCase())) {
        complexityScore += 1;
      }
    }

    // Determine complexity based on score
    return complexityScore >= 2 ? "complex" : "simple";
  }

  /**
   * Select model based on complexity level
   */
  private selectModelForComplexity(complexity: TaskComplexity): string {
    switch (complexity) {
      case "simple": {
        return "gpt-4o-mini";
      } // Fast, cost-effective for simple tasks
      case "complex": {
        return "gpt-4o";
      } // More capable for complex reasoning
      default: {
        return "gpt-4o-mini";
      } // Default to mini for efficiency
    }
  }

  /**
   * Get optimal model for specific grading task
   */
  async getModelForGradingTask(
    featureKey: string,
    responseType: string,
    inputLength: number,
    criteriaCount = 1,
  ): Promise<string> {
    const context: TaskComplexityContext = {
      featureKey,
      inputLength,
      responseType,
      requiresReasoning: true,
      hasMultipleCriteria: criteriaCount > 1,
      isValidationOnly: featureKey.toLowerCase().includes("validation"),
    };

    return this.getModelForComplexity(context);
  }

  /**
   * Get optimal model for validation task
   */
  async getModelForValidationTask(
    featureKey: string,
    inputLength = 0,
  ): Promise<string> {
    const context: TaskComplexityContext = {
      featureKey,
      inputLength,
      isValidationOnly: true,
      customComplexity: "simple",
    };

    return this.getModelForComplexity(context);
  }

  /**
   * Check if a feature has a specific model assigned
   */
  async isModelAssignedToFeature(
    featureKey: string,
    modelKey: string,
  ): Promise<boolean> {
    const assignedModel = await this.resolveModelForFeature(featureKey);
    return assignedModel === modelKey;
  }

  /**
   * Warmup cache by preloading common features
   */
  async warmupCache(featureKeys: string[]): Promise<void> {
    this.logger.log(`Warming up cache for ${featureKeys.length} features`);

    const promises = featureKeys.map((featureKey) =>
      this.resolveModelForFeature(featureKey).catch((error) => {
        this.logger.warn(`Failed to warmup cache for ${featureKey}:`, error);
        return null;
      }),
    );

    await Promise.all(promises);
    this.logger.log("Cache warmup completed");
  }
}
