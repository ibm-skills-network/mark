/* eslint-disable unicorn/no-null */
/* eslint-disable @typescript-eslint/require-await */
// src/api/assignment/v2/services/grading-consistency.service.ts
import * as crypto from "node:crypto";
import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { QuestionType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { RubricScore } from "src/api/llm/model/file.based.question.response.model";
import { Logger } from "winston";
import { PrismaService } from "../../../../database/prisma.service";
import {
  CriteriaDto,
  ScoringDto,
} from "../../dto/update.questions.request.dto";

interface GradingRecord {
  questionId: number;
  responseHash: string;
  points: number;
  maxPoints: number;
  feedback: string;
  rubricScores?: RubricScore[];
  timestamp: Date;
}

interface ConsistencyCheck {
  similar: boolean;
  previousGrade?: number;
  previousFeedback?: string;
  deviationPercentage?: number;
  shouldAdjust: boolean;
}

interface NormalizedScore {
  percentage: number;
  points: number;
  maxPoints: number;
}

interface ParsedRequestPayload {
  learnerTextResponse?: string;
  learnerResponse?: string;
  [key: string]: unknown;
}

interface ParsedResponsePayload {
  totalPoints?: number;
  maxPoints?: number;
  feedback?: unknown;
  [key: string]: unknown;
}

interface RubricValidationResult {
  valid: boolean;
  issues: string[];
  corrections: RubricScore[];
}

@Injectable()
export class GradingConsistencyService implements OnModuleDestroy {
  private readonly logger: Logger;
  private readonly gradingCache = new Map<string, GradingRecord[]>();
  private readonly cacheLocks = new Map<string, Promise<void>>();
  private readonly maxCacheSize = 1000; // Maximum cache entries
  private readonly cacheCleanupInterval = 3_600_000; // 1 hour
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({
      context: GradingConsistencyService.name,
    });

    // Start periodic cache cleanup
    this.cleanupTimer = setInterval(() => {
      this.cleanupCache();
    }, this.cacheCleanupInterval);
  }

  onModuleDestroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }

  /**
   * Generate a hash for response similarity checking
   */
  generateResponseHash(
    response: string,
    questionId: number,
    questionType: QuestionType,
  ): string {
    try {
      // Normalize the response for comparison
      const normalized = this.normalizeResponse(response, questionType);

      // Create a hash combining question and normalized response
      const hash = crypto
        .createHash("sha256")
        .update(`${questionId}:${normalized}`)
        .digest("hex")
        .slice(0, 32);

      return hash;
    } catch (error) {
      this.logger.error("Error generating response hash:", error);
      // Return a fallback hash
      return crypto.randomBytes(16).toString("hex");
    }
  }

  /**
   * Check for similar previous responses
   */
  async checkConsistency(
    questionId: number,
    responseHash: string,
    currentResponse: string,
    questionType: QuestionType,
  ): Promise<ConsistencyCheck> {
    try {
      // Check cache first
      const cacheKey = `q_${questionId}`;
      const cachedRecords = this.gradingCache.get(cacheKey) || [];

      // Check cached records first (faster)
      for (const record of cachedRecords) {
        if (this.isSimilarHash(responseHash, record.responseHash)) {
          return {
            similar: true,
            previousGrade: record.points,
            previousFeedback: record.feedback,
            deviationPercentage: 0, // Exact match
            shouldAdjust: false,
          };
        }
      }

      // Check database for recent similar responses
      const recentGradings = await this.prisma.gradingAudit.findMany({
        where: {
          questionId,
          timestamp: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
          },
        },
        orderBy: { timestamp: "desc" },
        take: 50, // Limit for performance
        select: {
          id: true,
          requestPayload: true,
          responsePayload: true,
          timestamp: true,
        },
      });

      // Analyze for similar responses
      for (const grading of recentGradings) {
        try {
          const requestData = this.safeJsonParse<ParsedRequestPayload>(
            grading.requestPayload,
          );
          const responseData = this.safeJsonParse<ParsedResponsePayload>(
            grading.responsePayload,
          );

          if (!requestData || !responseData) continue;

          const previousResponse =
            requestData.learnerTextResponse ||
            requestData.learnerResponse ||
            "";

          if (
            this.isSimilarResponse(
              currentResponse,
              previousResponse,
              questionType,
            )
          ) {
            const deviationPercentage = 0; // Will be calculated when current grade is known

            return {
              similar: true,
              previousGrade: responseData.totalPoints || 0,
              previousFeedback: JSON.stringify(responseData.feedback || ""),
              deviationPercentage,
              shouldAdjust: false, // Will be determined after grading
            };
          }
        } catch (error) {
          this.logger.debug(
            `Error parsing grading record ${grading.id}:`,
            error,
          );
        }
      }

      return {
        similar: false,
        shouldAdjust: false,
      };
    } catch (error) {
      this.logger.error("Error checking consistency:", error);
      return {
        similar: false,
        shouldAdjust: false,
      };
    }
  }

  /**
   * Record a grading for future consistency checks
   */
  async recordGrading(
    questionId: number,
    responseHash: string,
    points: number,
    maxPoints: number,
    feedback: string,
    rubricScores?: RubricScore[],
  ): Promise<void> {
    try {
      const record: GradingRecord = {
        questionId,
        responseHash,
        points,
        maxPoints,
        feedback,
        rubricScores,
        timestamp: new Date(),
      };

      // Update cache atomically
      await this.atomicCacheUpdate(`q_${questionId}`, record);
    } catch (error) {
      this.logger.error("Error recording grading:", error);
    }
  }

  /**
   * Validate rubric score consistency
   */
  validateRubricScores(
    rubricScores: RubricScore[],
    scoringCriteria: ScoringDto,
  ): RubricValidationResult {
    const issues: string[] = [];
    const corrections: RubricScore[] = [];

    if (!scoringCriteria?.rubrics || !Array.isArray(scoringCriteria.rubrics)) {
      return { valid: true, issues: [], corrections: rubricScores || [] };
    }

    if (!Array.isArray(rubricScores)) {
      issues.push("Rubric scores is not an array");
      return { valid: false, issues, corrections: [] };
    }

    // Ensure we have scores for all rubrics
    if (rubricScores.length !== scoringCriteria.rubrics.length) {
      issues.push(
        `Rubric count mismatch: ${rubricScores.length} scores for ${scoringCriteria.rubrics.length} rubrics`,
      );
    }

    // Validate each rubric score
    const maxIndex = Math.min(
      rubricScores.length,
      scoringCriteria.rubrics.length,
    );
    for (let index = 0; index < maxIndex; index++) {
      const score = rubricScores[index];
      const rubric = scoringCriteria.rubrics[index];

      if (!score || typeof score !== "object") {
        issues.push(`Invalid score object at index ${index}`);
        continue;
      }

      if (!rubric?.criteria || !Array.isArray(rubric.criteria)) {
        continue;
      }

      // Check if points are valid for this rubric
      const validPoints = rubric.criteria
        .filter((c: CriteriaDto) => c && typeof c.points === "number")
        .map((c: CriteriaDto) => c.points);

      if (validPoints.length === 0) {
        continue;
      }

      const currentPoints =
        typeof score.pointsAwarded === "number" ? score.pointsAwarded : 0;

      if (validPoints.includes(currentPoints)) {
        corrections.push(score);
      } else {
        issues.push(
          `Invalid points ${currentPoints} for rubric "${
            score.rubricQuestion || "Unknown"
          }"`,
        );

        let closestValid = validPoints[0];

        for (const current of validPoints) {
          if (
            Math.abs(current - currentPoints) <
            Math.abs(closestValid - currentPoints)
          ) {
            closestValid = current;
          }
        }

        corrections.push({
          ...score,
          pointsAwarded: closestValid,
        });
      }
    }

    return {
      valid: issues.length === 0,
      issues,
      corrections,
    };
  }

  /**
   * Get grading statistics for fairness analysis
   */
  async getGradingStatistics(questionId: number): Promise<{
    averageScore: number;
    standardDeviation: number;
    distribution: Record<string, number>;
    totalGradings: number;
  }> {
    try {
      const recentGradings = await this.prisma.gradingAudit.findMany({
        where: { questionId },
        orderBy: { timestamp: "desc" },
        take: 100,
        select: {
          responsePayload: true,
        },
      });

      const scores: number[] = [];
      const distribution: Record<string, number> = {};

      for (const grading of recentGradings) {
        try {
          const response = this.safeJsonParse<ParsedResponsePayload>(
            grading.responsePayload,
          );
          if (!response) continue;

          const percentage = Math.round(
            ((response.totalPoints || 0) / (response.maxPoints || 1)) * 100,
          );
          scores.push(percentage);

          const range = `${Math.floor(percentage / 10) * 10}-${
            Math.floor(percentage / 10) * 10 + 9
          }%`;
          distribution[range] = (distribution[range] || 0) + 1;
        } catch {
          // Skip invalid records
        }
      }

      const averageScore =
        scores.length > 0
          ? scores.reduce((a, b) => a + b, 0) / scores.length
          : 0;

      const variance =
        scores.length > 0
          ? scores.reduce(
              (sum, score) => sum + Math.pow(score - averageScore, 2),
              0,
            ) / scores.length
          : 0;

      const standardDeviation = Math.sqrt(variance);

      return {
        averageScore: Math.round(averageScore * 100) / 100,
        standardDeviation: Math.round(standardDeviation * 100) / 100,
        distribution,
        totalGradings: scores.length,
      };
    } catch (error) {
      this.logger.error("Error getting grading statistics:", error);
      return {
        averageScore: 0,
        standardDeviation: 0,
        distribution: {},
        totalGradings: 0,
      };
    }
  }

  /**
   * Normalize response for comparison
   */
  private normalizeResponse(
    response: string,
    questionType: QuestionType,
  ): string {
    if (!response || typeof response !== "string") {
      return "";
    }

    let normalized = response.toLowerCase().trim();

    // Limit length for performance
    if (normalized.length > 1000) {
      normalized = normalized.slice(0, 1000);
    }

    // Remove extra whitespace
    normalized = normalized.replaceAll(/\s+/g, " ");

    // Remove common punctuation for comparison
    normalized = normalized.replaceAll(/[!"',.:;?]/g, "");

    // Type-specific normalization
    switch (questionType) {
      case QuestionType.TEXT: {
        // Remove common filler words for text comparison
        const fillerWords = [
          "the",
          "a",
          "an",
          "and",
          "or",
          "but",
          "in",
          "on",
          "at",
          "to",
          "for",
        ];
        for (const word of fillerWords) {
          const regex = new RegExp(`\\b${word}\\b`, "g");
          normalized = normalized.replace(regex, "");
        }
        // Remove extra spaces created by word removal
        normalized = normalized.replaceAll(/\s+/g, " ").trim();
        break;
      }

      case QuestionType.SINGLE_CORRECT:
      case QuestionType.MULTIPLE_CORRECT: {
        // Normalize choice indicators
        normalized = normalized.replaceAll(/\b(option|choice|answer)\s*/gi, "");
        break;
      }

      case QuestionType.TRUE_FALSE: {
        // Normalize boolean responses
        if (/\b(true|yes|correct|right)\b/i.test(normalized)) {
          normalized = "true";
        } else if (/\b(false|no|incorrect|wrong)\b/i.test(normalized)) {
          normalized = "false";
        }
        break;
      }
    }

    return normalized;
  }

  /**
   * Check if two responses are similar
   */
  private isSimilarResponse(
    response1: string,
    response2: string,
    questionType: QuestionType,
  ): boolean {
    if (!response1 || !response2) {
      return false;
    }

    const normalized1 = this.normalizeResponse(response1, questionType);
    const normalized2 = this.normalizeResponse(response2, questionType);

    // For exact match types (choices, true/false)
    if (
      questionType === QuestionType.SINGLE_CORRECT ||
      questionType === QuestionType.MULTIPLE_CORRECT ||
      questionType === QuestionType.TRUE_FALSE
    ) {
      return normalized1 === normalized2;
    }

    // For text responses, use similarity threshold
    const similarity = this.calculateSimilarity(normalized1, normalized2);
    return similarity > 0.85; // 85% similarity threshold
  }

  /**
   * Check if two hashes are similar (for exact matches)
   */
  private isSimilarHash(hash1: string, hash2: string): boolean {
    return hash1 === hash2;
  }

  /**
   * Calculate similarity between two strings (0-1)
   */
  private calculateSimilarity(string1: string, string2: string): number {
    if (!string1 || !string2) return 0;
    if (string1 === string2) return 1;

    const longer = string1.length > string2.length ? string1 : string2;
    const shorter = string1.length > string2.length ? string2 : string1;

    if (longer.length === 0) {
      return 1;
    }

    // Use a more efficient algorithm for long strings
    if (longer.length > 500) {
      return this.calculateJaccardSimilarity(string1, string2);
    }

    const editDistance = this.getEditDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  /**
   * Calculate Jaccard similarity for long strings (more efficient)
   */
  private calculateJaccardSimilarity(string1: string, string2: string): number {
    const set1 = new Set(string1.split(" "));
    const set2 = new Set(string2.split(" "));

    const intersection = new Set([...set1].filter((x) => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * Calculate edit distance between two strings
   */
  private getEditDistance(string1: string, string2: string): number {
    const m = string1.length;
    const n = string2.length;

    // Create a 2D array for dynamic programming
    const dp: number[][] = Array.from({ length: m + 1 }, () =>
      // eslint-disable-next-line unicorn/no-new-array
      new Array<number>(n + 1).fill(0),
    );

    // Initialize first row and column
    for (let index = 0; index <= m; index++) {
      dp[index][0] = index;
    }
    for (let index = 0; index <= n; index++) {
      dp[0][index] = index;
    }

    // Fill the matrix
    for (let index = 1; index <= m; index++) {
      for (let index_ = 1; index_ <= n; index_++) {
        dp[index][index_] =
          string1[index - 1] === string2[index_ - 1]
            ? dp[index - 1][index_ - 1]
            : 1 +
              Math.min(
                dp[index - 1][index_],
                dp[index][index_ - 1],
                dp[index - 1][index_ - 1],
              );
      }
    }

    return dp[m][n];
  }

  /**
   * Normalize score to percentage
   */
  private normalizeScore(points: number, maxPoints: number): NormalizedScore {
    const safeMaxPoints = maxPoints > 0 ? maxPoints : 1;
    const percentage = (points / safeMaxPoints) * 100;

    return {
      percentage: Math.round(percentage * 100) / 100,
      points,
      maxPoints: safeMaxPoints,
    };
  }

  /**
   * Atomically update cache to prevent race conditions
   */
  private async atomicCacheUpdate(
    cacheKey: string,
    record: GradingRecord,
  ): Promise<void> {
    // Wait for any existing operation on this key
    const existingLock = this.cacheLocks.get(cacheKey);
    if (existingLock !== undefined) {
      await existingLock;
    }

    // Create a new lock for this operation
    const lockPromise = this.performCacheUpdate(cacheKey, record);
    this.cacheLocks.set(cacheKey, lockPromise);

    try {
      await lockPromise;
    } finally {
      // Remove lock after operation
      this.cacheLocks.delete(cacheKey);
    }
  }

  /**
   * Perform the actual cache update
   */
  private async performCacheUpdate(
    cacheKey: string,
    record: GradingRecord,
  ): Promise<void> {
    const existing = this.gradingCache.get(cacheKey) || [];
    existing.push(record);

    // Keep only recent records in cache (last 100)
    if (existing.length > 100) {
      existing.shift();
    }

    this.gradingCache.set(cacheKey, existing);

    // Check cache size
    if (this.gradingCache.size > this.maxCacheSize) {
      this.cleanupCache();
    }
  }

  /**
   * Safely parse JSON with type assertion
   */
  private safeJsonParse<T = unknown>(jsonString: string): T | null {
    try {
      if (!jsonString || typeof jsonString !== "string") {
        return null;
      }
      return JSON.parse(jsonString) as T;
    } catch {
      return null;
    }
  }

  /**
   * Clean up old cache entries
   */
  private cleanupCache(): void {
    try {
      const now = Date.now();
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours

      for (const [key, records] of this.gradingCache.entries()) {
        // Remove old records
        const filteredRecords = records.filter(
          (record) => now - record.timestamp.getTime() < maxAge,
        );

        if (filteredRecords.length === 0) {
          this.gradingCache.delete(key);
        } else if (filteredRecords.length < records.length) {
          this.gradingCache.set(key, filteredRecords);
        }
      }

      // If still too large, remove oldest entries
      if (this.gradingCache.size > this.maxCacheSize) {
        const sortedKeys = [...this.gradingCache.keys()].sort();
        const keysToRemove = sortedKeys.slice(
          0,
          sortedKeys.length - this.maxCacheSize,
        );
        for (const key of keysToRemove) this.gradingCache.delete(key);
      }

      this.logger.debug(
        `Cache cleanup completed. Current size: ${this.gradingCache.size}`,
      );
    } catch (error) {
      this.logger.error("Error during cache cleanup:", error);
    }
  }
}
