/**
 * Interface for answer normalization and claim extraction
 */
export interface INormalizedAnswer {
  /**
   * Original text before normalization
   */
  original: string;

  /**
   * Normalized text (lowercase, stripped punctuation, whitespace normalized)
   */
  normalized: string;

  /**
   * Individual claims/sentences extracted from the answer
   */
  claims: string[];

  /**
   * Stable hash of the normalized answer for cache lookups
   */
  hash: string;

  /**
   * Word count in normalized answer
   */
  wordCount: number;
}

export interface IAnswerNormalizationService {
  /**
   * Normalize an answer and extract claims
   */
  normalizeAnswer(answer: string): INormalizedAnswer;

  /**
   * Generate a stable hash for an answer
   */
  hashAnswer(normalizedText: string): string;

  /**
   * Hash a rubric/scoring criteria for cache keys
   */
  hashRubric(rubricJson: string): string;

  /**
   * Generate a combined hash for rubric + answer for cache keys
   */
  generateCacheKey(
    rubricHash: string,
    answerHash: string,
    questionId?: number,
    modelIdentity?: string,
  ): string;

  /**
   * Extract individual claims (sentences) from text
   */
  extractClaims(text: string): string[];

  /**
   * Check if two normalized answers are semantically identical
   */
  areAnswersEquivalent(hash1: string, hash2: string): boolean;
}
