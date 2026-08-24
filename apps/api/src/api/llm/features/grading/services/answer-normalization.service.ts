import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import {
  IAnswerNormalizationService,
  INormalizedAnswer,
} from "../interfaces/answer-normalization.interface";

/**
 * Service for normalizing learner answers to ensure consistent grading
 *
 * This service:
 * - Normalizes text (lowercase, strip punctuation, normalize whitespace)
 * - Extracts individual claims/sentences
 * - Generates stable hashes for cache lookups
 * - Enables deterministic "same input → same output" grading
 */
@Injectable()
export class AnswerNormalizationService implements IAnswerNormalizationService {
  /**
   * Normalize an answer and extract claims
   */
  normalizeAnswer(answer: string): INormalizedAnswer {
    if (!answer || typeof answer !== "string") {
      return {
        original: "",
        normalized: "",
        claims: [],
        hash: this.hashAnswer(""),
        wordCount: 0,
      };
    }

    const original = answer.trim();

    const normalized = this.normalizeText(original);

    const claims = this.extractClaims(normalized);

    const hash = this.hashAnswer(normalized);

    const wordCount = this.countWords(normalized);

    return {
      original,
      normalized,
      claims,
      hash,
      wordCount,
    };
  }

  /**
   * Normalize text for comparison
   * - Convert to lowercase
   * - Remove extra whitespace
   * - Strip most punctuation (keep some for meaning)
   * - Normalize unicode
   */
  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .normalize("NFD")
      .replaceAll(/[\u0300-\u036F]/g, "")
      .replaceAll(/[\t\n\r]+/g, " ")
      .replaceAll(/[^\s\w,.]/g, "")
      .replaceAll(/\s+/g, " ")
      .trim();
  }

  /**
   * Extract individual claims (sentences) from text
   * Claims are split on:
   * - Period followed by space
   * - Semicolon
   * - Newlines (if present in original)
   */
  extractClaims(text: string): string[] {
    if (!text) return [];

    const sentences = text
      .split(/\.\s+|;\s*|,\s+(?=(?:and|or|but|however|therefore)\s)/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    return sentences;
  }

  /**
   * Generate a stable hash for an answer using SHA-256
   * This hash is used for cache lookups and consistency checking
   */
  hashAnswer(normalizedText: string): string {
    if (!normalizedText) return "";

    return createHash("sha256").update(normalizedText).digest("hex");
  }

  /**
   * Check if two normalized answers are semantically identical
   * For now, this is a simple hash comparison
   * Future: could use Levenshtein distance or semantic similarity
   */
  areAnswersEquivalent(hash1: string, hash2: string): boolean {
    return hash1 === hash2;
  }

  /**
   * Count words in normalized text
   */
  private countWords(text: string): number {
    if (!text) return 0;

    return text.split(/\s+/).filter((word) => word.length > 0).length;
  }

  /**
   * Generate a combined hash for rubric + answer for cache keys
   */
  generateCacheKey(
    rubricHash: string,
    answerHash: string,
    questionId?: number,
    modelIdentity?: string,
  ): string {
    const combined = `${questionId || ""}:${rubricHash}:${answerHash}:${modelIdentity || ""}`;
    return createHash("sha256").update(combined).digest("hex");
  }

  /**
   * Hash a rubric/scoring criteria for cache keys
   */
  hashRubric(rubricJson: string): string {
    try {
      const parsed: unknown = JSON.parse(rubricJson);
      if (parsed && typeof parsed === "object") {
        const parsedRecord = parsed as Record<string, unknown>;
        const keys = Object.keys(parsedRecord).sort();
        const normalized = JSON.stringify(parsedRecord, keys);
        return createHash("sha256").update(normalized).digest("hex");
      }
      return createHash("sha256").update(rubricJson).digest("hex");
    } catch {
      return createHash("sha256").update(rubricJson).digest("hex");
    }
  }
}
