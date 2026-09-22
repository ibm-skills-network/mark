/* eslint-disable unicorn/no-null */
/* eslint-disable @typescript-eslint/require-await */
import * as crypto from "node:crypto";
import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { QuestionType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { RubricScore } from "src/api/llm/model/file.based.question.response.model";
import { UserRole } from "src/auth/interfaces/user.session.interface";
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
  /** Grading model identity that produced this grade, when known. */
  modelIdentity?: string;
}

interface ConsistencyCheck {
  similar: boolean;
  previousGrade?: number;
  previousFeedback?: string;
  deviationPercentage?: number;
  shouldAdjust: boolean;
  /** Why the grade was reused, for the caller's own logging and metadata. */
  reuseReason?: GradeReuseReason;
}

/** How a prior grade qualified for reuse. */
export type GradeReuseReason =
  | "exact_match_in_session"
  | "exact_match"
  | "same_learner_near_match";

/**
 * Everything a reuse decision needs beyond the answer itself.
 *
 * Callers pass this only for a learner submission, where every field is read
 * server-side: the question row and its full marks from the database, the
 * grading model from the model router, the owner from the attempt row. An
 * author preview grades a question carried in the request body, so it neither
 * looks up nor records reusable grades at all - see the role checks in
 * `TextGradingStrategy.tryReuseFromConsistency` and
 * `AbstractGradingStrategy.recordConsistencyData`. Candidates are additionally
 * filtered on the role recorded with them, so a preview that predates those
 * checks is still refused here.
 */
export interface GradeReuseLookup {
  /** Type of the question being graded, used to normalise both answers. */
  questionType: QuestionType;
  /**
   * Full marks for the question. A prior grade below this is never reused —
   * replaying a full-marks grade can only ever be generous, replaying anything
   * lower hands one submission's loss to another.
   */
  maxPoints?: number;
  /** Grading model identity that must have produced any reusable grade. */
  modelIdentity?: string;
  /**
   * Stable, non-reversible identifier of the learner being graded, from
   * `deriveLearnerKey`. Only this learner's own prior answers qualify for a
   * near match; everyone else's need an exact one.
   */
  learnerKey?: string;
  /** Attempt being graded, so a reuse can be traced back to a submission. */
  attemptId?: number;
}

/**
 * Derive the identifier used to tell one learner's prior grades from another's.
 * userId is an email in this system, so it is hashed rather than stored beside
 * every grading record.
 */
export function deriveLearnerKey(userId: string): string {
  return crypto
    .createHash("sha256")
    .update(userId.trim().toLowerCase())
    .digest("hex")
    .slice(0, 32);
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
  metadata?: { maxPossiblePoints?: number; [key: string]: unknown };
  [key: string]: unknown;
}

interface ParsedAuditMetadata {
  modelSnapshot?: string;
  learnerKey?: string;
  /** Marks the candidate was scored out of when it was graded. */
  maxPoints?: number;
  /** Role of whoever the grading ran for; only a learner's grade is reusable. */
  userRole?: string;
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
  private readonly maxCacheSize = 1000;
  private readonly cacheCleanupInterval = 300_000;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({
      context: GradingConsistencyService.name,
    });

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
   * Generate a versioned, lossless hash for exact-answer reuse
   */
  generateResponseHash(
    response: string,
    questionId: number,
    questionType: QuestionType,
  ): string {
    try {
      const hash = crypto
        .createHash("sha256")
        .update(
          JSON.stringify(["exact-v2", questionId, questionType, response]),
        )
        .digest("hex")
        .slice(0, 32);

      return `exact-v2:${hash}`;
    } catch (error) {
      this.logger.error("Error generating response hash:", error);
      return crypto.randomBytes(16).toString("hex");
    }
  }

  /**
   * Find a previous grade that may be served for this answer instead of
   * grading it again.
   *
   * Two things make a prior grade reusable and both are required:
   *
   * 1. It awarded full marks. A cached full score replayed onto a near-identical
   *    answer is at worst generous; a cached partial or zero is how one
   *    submission's loss became everybody else's.
   * 2. It is either the same learner's own earlier answer (which may differ in
   *    small ways) or *any* learner's byte-for-byte equivalent answer. A near
   *    match across learners is exactly where a single token decides correctness.
   */
  async checkConsistency(
    questionId: number,
    responseHash: string,
    currentResponse: string,
    lookup: GradeReuseLookup,
  ): Promise<ConsistencyCheck> {
    const { questionType, maxPoints, modelIdentity, learnerKey, attemptId } =
      lookup;

    try {
      // A grade carries the judgement of whichever model produced it. When the
      // model about to grade cannot be identified, no stored grade can be shown
      // to have come from it, so nothing is reusable.
      if (!modelIdentity) {
        this.logRejectedCandidate(
          questionId,
          attemptId,
          "unknown_grading_model",
        );
        return {
          similar: false,
          shouldAdjust: false,
        };
      }

      const cacheKey = this.buildCacheKey(questionId, modelIdentity);
      const cachedRecords = this.gradingCache.get(cacheKey) || [];

      for (const record of cachedRecords) {
        if (!this.isSimilarHash(responseHash, record.responseHash)) {
          continue;
        }

        const rejection = this.rejectUnlessFullMarks(
          record.points,
          record.maxPoints,
          maxPoints,
        );
        if (rejection) {
          this.logRejectedCandidate(questionId, attemptId, rejection);
          continue;
        }

        return this.acceptReuse(
          questionId,
          attemptId,
          "exact_match_in_session",
          record.points,
          record.feedback,
        );
      }

      const recentGradings = await this.prisma.gradingAudit.findMany({
        where: {
          questionId,
          timestamp: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
        },
        orderBy: { timestamp: "desc" },
        take: 50,
        select: {
          id: true,
          requestPayload: true,
          responsePayload: true,
          metadata: true,
          timestamp: true,
        },
      });

      for (const grading of recentGradings) {
        try {
          const requestData = this.safeJsonParse<ParsedRequestPayload>(
            grading.requestPayload,
          );
          const responseData = this.safeJsonParse<ParsedResponsePayload>(
            grading.responsePayload,
          );

          if (!requestData || !responseData) continue;

          const auditMetadata = this.safeJsonParse<ParsedAuditMetadata>(
            grading.metadata ?? "",
          );

          // A grade is only reusable if the same grader produced it. Reusing
          // across models silently serves the previous model's judgement under
          // the new model's name, which no cache-identity elsewhere can undo
          // and which makes a model A/B measure the model it replaced.
          // Records predating model tracking carry no snapshot and are treated
          // as not reusable rather than assumed to match.
          if (auditMetadata?.modelSnapshot !== modelIdentity) {
            this.logRejectedCandidate(
              questionId,
              attemptId,
              "grading_model_mismatch",
              grading.id,
            );
            continue;
          }

          // An author preview is graded against a question body supplied in
          // the request, so its score describes whatever the author typed, not
          // the stored question a learner is answering.
          if (auditMetadata?.userRole !== UserRole.LEARNER) {
            this.logRejectedCandidate(
              questionId,
              attemptId,
              "not_a_learner_grading",
              grading.id,
            );
            continue;
          }

          const previousResponse =
            requestData.learnerTextResponse ||
            requestData.learnerResponse ||
            "";

          const exactMatch =
            previousResponse.length > 0 &&
            this.generateResponseHash(
              previousResponse,
              questionId,
              questionType,
            ) === responseHash;

          const sameLearner =
            typeof learnerKey === "string" &&
            learnerKey.length > 0 &&
            auditMetadata?.learnerKey === learnerKey;

          if (!exactMatch) {
            if (!sameLearner) {
              this.logRejectedCandidate(
                questionId,
                attemptId,
                "another_learner_without_exact_match",
                grading.id,
              );
              continue;
            }

            if (
              !this.isSimilarResponse(
                currentResponse,
                previousResponse,
                questionType,
              )
            ) {
              this.logRejectedCandidate(
                questionId,
                attemptId,
                "answer_not_similar",
                grading.id,
              );
              continue;
            }
          }

          const rejection = this.rejectUnlessFullMarks(
            responseData.totalPoints,
            responseData.maxPoints ??
              responseData.metadata?.maxPossiblePoints ??
              auditMetadata?.maxPoints,
            maxPoints,
          );
          if (rejection) {
            this.logRejectedCandidate(
              questionId,
              attemptId,
              rejection,
              grading.id,
            );
            continue;
          }

          return this.acceptReuse(
            questionId,
            attemptId,
            exactMatch ? "exact_match" : "same_learner_near_match",
            responseData.totalPoints ?? 0,
            JSON.stringify(responseData.feedback || ""),
            grading.id,
          );
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
   * Reasons a candidate grade was refused, or undefined when it awarded full
   * marks for the question being graded right now. Anything unknown counts as
   * a refusal: without both numbers there is no way to tell a full score from
   * a zero.
   */
  private rejectUnlessFullMarks(
    points: number | undefined,
    recordedMaxPoints: number | undefined,
    requestedMaxPoints: number | undefined,
  ): string | undefined {
    if (
      typeof requestedMaxPoints !== "number" ||
      !Number.isFinite(requestedMaxPoints) ||
      requestedMaxPoints <= 0
    ) {
      return "unknown_max_points";
    }

    // A candidate that never recorded the total it was scored out of cannot be
    // shown to have earned full marks for the question being graded now. It is
    // refused rather than assumed to match: that assumption is how a 20/20
    // grade was replayed onto the same question after its total was lowered to
    // 10, awarding 20 points on a 10-point question.
    if (
      typeof recordedMaxPoints !== "number" ||
      !Number.isFinite(recordedMaxPoints)
    ) {
      return "recorded_max_points_missing";
    }

    // The candidate was scored out of a different total, so its points do not
    // describe this question's marks at all.
    if (recordedMaxPoints !== requestedMaxPoints) {
      return "max_points_changed";
    }

    if (typeof points !== "number" || !Number.isFinite(points)) {
      return "unknown_points";
    }

    if (points < requestedMaxPoints) {
      return "below_full_marks";
    }

    if (points > requestedMaxPoints) {
      return "above_full_marks";
    }

    return undefined;
  }

  private acceptReuse(
    questionId: number,
    attemptId: number | undefined,
    reason: GradeReuseReason,
    points: number,
    feedback: string,
    auditId?: number,
  ): ConsistencyCheck {
    this.logger.info("Reusing a prior grade instead of grading again", {
      questionId,
      attemptId,
      reason,
      points,
      auditId,
    });

    return {
      similar: true,
      previousGrade: points,
      previousFeedback: feedback,
      deviationPercentage: 0,
      shouldAdjust: false,
      reuseReason: reason,
    };
  }

  private logRejectedCandidate(
    questionId: number,
    attemptId: number | undefined,
    reason: string,
    auditId?: number,
  ): void {
    this.logger.debug("Refused a prior grade as a reuse candidate", {
      questionId,
      attemptId,
      reason,
      auditId,
    });
  }

  /**
   * In-memory reuse is partitioned by grading model for the same reason the
   * persistent lookup filters on it: entries written by one model must not be
   * served once the feature is routed to another.
   */
  private buildCacheKey(questionId: number, modelIdentity?: string): string {
    return modelIdentity
      ? `q_${questionId}::${modelIdentity}`
      : `q_${questionId}`;
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
    modelIdentity?: string,
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
        modelIdentity,
      };

      await this.atomicCacheUpdate(
        this.buildCacheKey(questionId, modelIdentity),
        record,
      );
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

    if (rubricScores.length !== scoringCriteria.rubrics.length) {
      issues.push(
        `Rubric count mismatch: ${rubricScores.length} scores for ${scoringCriteria.rubrics.length} rubrics`,
      );
    }

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
          this.logger.warn(
            `Error parsing grading response: ${grading.responsePayload}`,
          );
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

    if (normalized.length > 1000) {
      normalized = normalized.slice(0, 1000);
    }

    normalized = normalized.replaceAll(/\s+/g, " ");

    normalized = normalized.replaceAll(/[!"',.:;?]/g, "");

    switch (questionType) {
      case QuestionType.TEXT: {
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
        normalized = normalized.replaceAll(/\s+/g, " ").trim();
        break;
      }
      case QuestionType.SINGLE_CORRECT:
      case QuestionType.MULTIPLE_CORRECT: {
        normalized = normalized.replaceAll(/\b(option|choice|answer)\s*/gi, "");
        break;
      }
      case QuestionType.TRUE_FALSE: {
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
   * Check if two responses are close enough to count as the same answer.
   *
   * Only reachable for a learner's own earlier answers. Across learners a near
   * match is worthless — on short code, SQL or numeric answers a single token
   * is the whole difference between right and wrong, and both sides of that
   * line score well above any threshold this could use.
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

    if (
      questionType === QuestionType.SINGLE_CORRECT ||
      questionType === QuestionType.MULTIPLE_CORRECT ||
      questionType === QuestionType.TRUE_FALSE
    ) {
      return normalized1 === normalized2;
    }

    const similarity = this.calculateSimilarity(normalized1, normalized2);
    return similarity > 0.85;
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

    const dp: number[][] = Array.from({ length: m + 1 }, () =>
      // eslint-disable-next-line unicorn/no-new-array
      new Array<number>(n + 1).fill(0),
    );

    for (let index = 0; index <= m; index++) {
      dp[index][0] = index;
    }
    for (let index = 0; index <= n; index++) {
      dp[0][index] = index;
    }

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
    const existingLock = this.cacheLocks.get(cacheKey);
    if (existingLock !== undefined) {
      await existingLock;
    }

    const lockPromise = this.performCacheUpdate(cacheKey, record);
    this.cacheLocks.set(cacheKey, lockPromise);

    try {
      await lockPromise;
    } finally {
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

    if (existing.length > 100) {
      existing.shift();
    }

    this.gradingCache.set(cacheKey, existing);

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
      const maxAge = 24 * 60 * 60 * 1000;

      for (const [key, records] of this.gradingCache.entries()) {
        const filteredRecords = records.filter(
          (record) => now - record.timestamp.getTime() < maxAge,
        );

        if (filteredRecords.length === 0) {
          this.gradingCache.delete(key);
        } else if (filteredRecords.length < records.length) {
          this.gradingCache.set(key, filteredRecords);
        }
      }

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
