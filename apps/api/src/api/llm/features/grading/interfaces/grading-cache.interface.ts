/**
 * Cached grading result for deterministic re-grading
 */
export interface ICachedGradingResult {
  /**
   * Unique cache key (combination of rubric hash + answer hash)
   */
  cacheKey: string;

  /**
   * Question ID this grading applies to
   */
  questionId: number;

  /**
   * Hash of the rubric/scoring criteria
   */
  rubricHash: string;

  /**
   * Hash of the normalized answer
   */
  answerHash: string;

  /**
   * Total score awarded
   */
  totalScore: number;

  /**
   * Maximum possible score
   */
  maxScore: number;

  /**
   * Individual criterion scores
   */
  criteria: Array<{
    criterionId: string;
    pointsAwarded: number;
    maxPoints: number;
    evidence: string | null;
    feedback: string;
  }>;

  /**
   * Overall feedback
   */
  overallFeedback: string;

  /**
   * When this grading was first cached
   */
  cachedAt: Date;

  /**
   * How many times this cached result has been used
   */
  hitCount: number;

  /**
   * Metadata about the grading
   */
  metadata?: {
    gradingTimeMs?: number;
    attempts?: number;
    judgeApproved?: boolean;
    graderVersion?: string;
    modelSnapshot?: string;
    fileResponse?: Record<string, unknown>;
  };
}

export interface IGradingCacheService {
  /**
   * Get a cached grading result if it exists
   */
  getCachedGrading(cacheKey: string): Promise<ICachedGradingResult | null>;

  /**
   * Store a grading result in the cache
   */
  cacheGrading(result: ICachedGradingResult): Promise<void>;

  /**
   * Store the first result for a key and return that canonical result.
   * Concurrent graders therefore converge on the same persisted score.
   */
  cacheGradingIfAbsent(
    result: ICachedGradingResult,
  ): Promise<ICachedGradingResult>;

  /**
   * Check if a grading result is cached
   */
  isCached(cacheKey: string): Promise<boolean>;

  /**
   * Get cache statistics
   */
  getCacheStats(questionId: number): Promise<{
    totalCached: number;
    totalHits: number;
    cacheHitRate: number;
  }>;

  /**
   * Invalidate cache for a specific question (e.g., when rubric changes)
   */
  invalidateQuestionCache(questionId: number): Promise<void>;
}
