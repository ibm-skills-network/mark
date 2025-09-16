/* eslint-disable unicorn/no-useless-undefined */
/* eslint-disable @typescript-eslint/require-await */
import { Injectable, Logger } from "@nestjs/common";
import MiniSearch from "minisearch";
import {
  CircuitBreakerData,
  EvidenceMatch,
  EvidenceVerificationData,
  GradeData,
  ValidatedGradeData,
} from "../types/grading.types";

interface EvidenceServiceConfig {
  fuzzyThreshold: number;
  minQuoteLength: number;
  maxAnswerLength: number;
  searchTimeout: number;
  enableFallbacks: boolean;
}

interface SearchDocument {
  id: number;
  text: string;
  original: string;
  position: number;
  length: number;
}

interface SearchResult {
  id: number;
  score: number;
  match: Record<string, string[]>;
  terms: string[];
  queryTerms: string[];
}

type MiniSearchInstance = {
  addAll: (documents: SearchDocument[]) => void;
  search: (query: string, options?: Record<string, unknown>) => SearchResult[];
};

@Injectable()
export class EvidenceService {
  private readonly logger = new Logger(EvidenceService.name);
  private readonly config: EvidenceServiceConfig;
  private circuitBreaker: CircuitBreakerData = {
    failures: 0,
    isOpen: false,
    resetTimeout: 60_000,
  };

  constructor(config?: Partial<EvidenceServiceConfig>) {
    this.config = {
      fuzzyThreshold: 0.7,
      minQuoteLength: 10,
      maxAnswerLength: 50_000,
      searchTimeout: 30_000,
      enableFallbacks: true,
      ...config,
    };
  }

  async verifyEvidence(
    answer: string,
    grade: GradeData,
  ): Promise<EvidenceVerificationData> {
    const startTime = Date.now();

    try {
      if (this.isCircuitBreakerOpen()) {
        this.logger.warn("Circuit breaker open, using fallback verification");
        return this.fallbackVerification(answer, grade);
      }

      if (answer.length > this.config.maxAnswerLength) {
        this.logger.warn(
          `Answer too long (${answer.length} chars), truncating`,
        );
        answer = answer.slice(0, Math.max(0, this.config.maxAnswerLength));
      }

      const invalidCriteriaIds: string[] = [];
      const details: Array<{
        criterionId: string;
        issue: "missing_evidence" | "evidence_not_found" | "fuzzy_match_failed";
        evidence?: string;
      }> = [];

      const searchIndex = await this.createSearchIndexWithTimeout(answer);
      if (!searchIndex) {
        this.logger.error("Failed to create search index, using fallback");
        return this.fallbackVerification(answer, grade);
      }

      for (const award of grade.criteriaAwards) {
        if (award.awarded === 0) {
          continue;
        }

        if (
          !award.evidence ||
          award.evidence.trim().length < this.config.minQuoteLength
        ) {
          invalidCriteriaIds.push(award.criterionId);
          details.push({
            criterionId: award.criterionId,
            issue: "missing_evidence",
            evidence: award.evidence,
          });
          continue;
        }

        try {
          const match = await this.findEvidenceMatchWithFallbacks(
            answer,
            award.evidence,
            searchIndex,
          );
          if (!match) {
            invalidCriteriaIds.push(award.criterionId);
            details.push({
              criterionId: award.criterionId,
              issue: "evidence_not_found",
              evidence: award.evidence,
            });
          } else if (match.similarity < this.config.fuzzyThreshold) {
            invalidCriteriaIds.push(award.criterionId);
            details.push({
              criterionId: award.criterionId,
              issue: "fuzzy_match_failed",
              evidence: award.evidence,
            });
          }
        } catch (error) {
          this.logger.error(
            `Evidence matching failed for ${award.criterionId}:`,
            error,
          );
          invalidCriteriaIds.push(award.criterionId);
          details.push({
            criterionId: award.criterionId,
            issue: "evidence_not_found",
            evidence: award.evidence,
          });
        }
      }

      this.recordSuccess();
      const processingTime = Date.now() - startTime;
      this.logger.debug(
        `Evidence verification completed in ${processingTime}ms`,
      );

      return {
        ok: invalidCriteriaIds.length === 0,
        invalidCriteriaIds,
        details,
      };
    } catch (error) {
      this.recordFailure();
      this.logger.error("Evidence verification failed:", error);

      if (this.config.enableFallbacks) {
        return this.fallbackVerification(answer, grade);
      }

      throw error;
    }
  }

  private async createSearchIndexWithTimeout(
    text: string,
  ): Promise<MiniSearchInstance | undefined> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.logger.warn("Search index creation timed out");
        void resolve(undefined);
      }, this.config.searchTimeout);

      try {
        const sentences = this.splitIntoSentences(text);
        const documents: SearchDocument[] = sentences.map(
          (sentence, index) => ({
            id: index,
            text: sentence.toLowerCase(),
            original: sentence,
            position: text.indexOf(sentence),
            length: sentence.length,
          }),
        );

        const miniSearch = new MiniSearch<SearchDocument>({
          fields: ["text"],
          storeFields: ["original", "position", "length"],
          tokenize: (string: string) =>
            string.split(/\s+/).filter((token) => token.length > 1),
          processTerm: (term: string) => term.toLowerCase(),
        }) as MiniSearchInstance;

        miniSearch.addAll(documents);
        clearTimeout(timeout);
        resolve(miniSearch);
      } catch (error) {
        clearTimeout(timeout);
        this.logger.error("Error creating search index:", error);
        resolve(undefined);
      }
    });
  }

  private async findEvidenceMatchWithFallbacks(
    answer: string,
    evidence: string,
    searchIndex: MiniSearchInstance,
  ): Promise<EvidenceMatch | undefined> {
    const cleanEvidence = evidence.trim().toLowerCase();
    const cleanAnswer = answer.toLowerCase();

    const exactMatch = cleanAnswer.indexOf(cleanEvidence);
    if (exactMatch !== -1) {
      return {
        quote: evidence,
        position: exactMatch,
        similarity: 1,
        method: "exact",
      };
    }

    try {
      const fuzzyMatch = this.performFuzzySearch(cleanEvidence, searchIndex);
      if (fuzzyMatch && fuzzyMatch.similarity >= this.config.fuzzyThreshold) {
        return fuzzyMatch;
      }
    } catch (error) {
      this.logger.warn("Fuzzy search failed, trying keyword fallback:", error);
    }

    if (this.config.enableFallbacks) {
      return this.performKeywordMatch(cleanEvidence, cleanAnswer);
    }

    return undefined;
  }

  private performFuzzySearch(
    evidence: string,
    searchIndex: MiniSearchInstance,
  ): EvidenceMatch | undefined {
    const searchResults = searchIndex.search(evidence, {
      fuzzy: 0.3,
      prefix: true,
      boost: { text: 2 },
      combineWith: "AND",
    });

    if (searchResults.length === 0) {
      return undefined;
    }

    const bestMatch = searchResults[0];
    const matchedDocument = {
      original: String(bestMatch.match?.original?.[0] || ""),
      position: 0,
    };
    const similarity = this.calculateAdvancedSimilarity(
      evidence,
      matchedDocument.original.toLowerCase(),
    );

    return {
      quote: matchedDocument.original,
      position: matchedDocument.position,
      similarity,
      method: "fuzzy",
    };
  }

  private performKeywordMatch(
    evidence: string,
    answer: string,
  ): EvidenceMatch | undefined {
    const evidenceWords = evidence
      .split(/\s+/)
      .filter((word) => word.length > 3);
    const matchedWords = evidenceWords.filter((word) => answer.includes(word));

    if (matchedWords.length === 0) return undefined;

    const similarity = matchedWords.length / evidenceWords.length;
    if (similarity < 0.5) return undefined;

    const firstMatch = answer.indexOf(matchedWords[0]);
    return {
      quote: matchedWords.join(" "),
      position: firstMatch,
      similarity,
      method: "keyword",
    };
  }

  private calculateAdvancedSimilarity(text1: string, text2: string): number {
    const words1 = text1.split(/\s+/).filter((w) => w.length > 1);
    const words2 = text2.split(/\s+/).filter((w) => w.length > 1);

    if (words1.length === 0 || words2.length === 0) return 0;

    const set1 = new Set(words1);
    const set2 = new Set(words2);

    const intersection = new Set([...set1].filter((x) => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    const jaccardSimilarity = intersection.size / union.size;

    const lengthSimilarity =
      Math.min(text1.length, text2.length) /
      Math.max(text1.length, text2.length);

    return jaccardSimilarity * 0.7 + lengthSimilarity * 0.3;
  }

  private splitIntoSentences(text: string): string[] {
    return text
      .split(/[!.?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 5);
  }

  private fallbackVerification(
    answer: string,
    grade: GradeData,
  ): EvidenceVerificationData {
    this.logger.log("Using fallback evidence verification");

    const invalidCriteriaIds: string[] = [];
    const details: Array<{
      criterionId: string;
      issue: "missing_evidence" | "evidence_not_found" | "fuzzy_match_failed";
      evidence?: string;
    }> = [];

    for (const award of grade.criteriaAwards) {
      if (award.awarded === 0) continue;

      if (
        !award.evidence ||
        award.evidence.trim().length < this.config.minQuoteLength
      ) {
        invalidCriteriaIds.push(award.criterionId);
        details.push({
          criterionId: award.criterionId,
          issue: "missing_evidence",
          evidence: award.evidence,
        });
      } else {
        const simpleMatch = answer
          .toLowerCase()
          .includes(award.evidence.toLowerCase());
        if (!simpleMatch) {
          invalidCriteriaIds.push(award.criterionId);
          details.push({
            criterionId: award.criterionId,
            issue: "evidence_not_found",
            evidence: award.evidence,
          });
        }
      }
    }

    return {
      ok: invalidCriteriaIds.length === 0,
      invalidCriteriaIds,
      details,
    };
  }

  private isCircuitBreakerOpen(): boolean {
    if (!this.circuitBreaker.isOpen) return false;

    const now = Date.now();
    if (
      this.circuitBreaker.lastFailure &&
      now - this.circuitBreaker.lastFailure > this.circuitBreaker.resetTimeout
    ) {
      this.circuitBreaker.isOpen = false;
      this.circuitBreaker.failures = 0;
      this.logger.log("Circuit breaker reset");
      return false;
    }

    return true;
  }

  private recordSuccess(): void {
    if (this.circuitBreaker.failures > 0) {
      this.circuitBreaker.failures = Math.max(
        0,
        this.circuitBreaker.failures - 1,
      );
    }
  }

  private recordFailure(): void {
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailure = Date.now();

    if (this.circuitBreaker.failures >= 3) {
      this.circuitBreaker.isOpen = true;
      this.logger.warn("Circuit breaker opened due to failures");
    }
  }

  zeroOutInvalidCriteria(
    grade: ValidatedGradeData,
    invalidCriteriaIds: string[],
  ): ValidatedGradeData {
    const updatedCriteriaAwards = grade.criteriaAwards.map((award) => {
      if (invalidCriteriaIds.includes(award.criterionId)) {
        return {
          ...award,
          awarded: 0,
          justification: `${award.justification} [Evidence verification failed]`,
        };
      }
      return award;
    });

    const newTotalAwarded = updatedCriteriaAwards.reduce(
      (sum, award) => sum + award.awarded,
      0,
    );

    return {
      ...grade,
      criteriaAwards: updatedCriteriaAwards,
      totalAwarded: newTotalAwarded,
    };
  }
}
