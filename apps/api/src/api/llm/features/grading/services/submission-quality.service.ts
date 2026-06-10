import { Injectable } from "@nestjs/common";
import { GRADING_QUALITY } from "../constants";
import {
  ChunkEligibility,
  ChunkIneligibleReason,
  ChunkQuality,
  ExtractedChunk,
  SubmissionQualityClassification,
  SubmissionQualityMetadata,
} from "../types/criterion-evidence.types";

interface QualityContext {
  question?: string;
  rubricText?: string;
}

interface ClassifyChunksResult {
  chunks: ExtractedChunk[];
  quality: SubmissionQualityMetadata;
}

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "shall",
  "can",
  "to",
  "of",
  "in",
  "on",
  "at",
  "for",
  "with",
  "it",
  "its",
  "this",
  "that",
  "these",
  "those",
  "and",
  "or",
  "but",
  "not",
  "by",
  "from",
  "up",
  "about",
  "into",
  "through",
  "after",
  "before",
  "if",
  "as",
  "so",
  "no",
  "my",
  "we",
  "our",
  "you",
  "your",
  "he",
  "she",
  "they",
  "them",
  "their",
  "i",
  "me",
  "all",
  "any",
  "each",
  "both",
]);

const PAGE_LABEL_PATTERN =
  /^-?\s*(page\s+)?\d+(\s*[-/]\s*\d+|\s+of\s+\d+)?\s*-?\.?$/i;

const METADATA_BANNER_PREFIXES = [
  "=== pdf document ===",
  "--- content ---",
  "=== generated summary ===",
  "=== validator report ===",
];

const METADATA_KEY_PATTERN = /^(pages|title|creator|author|subject|keywords)\s*:/i;

@Injectable()
export class SubmissionQualityService {
  classifyChunks(
    chunks: ExtractedChunk[],
    context?: QualityContext,
  ): ClassifyChunksResult {
    if (chunks.length === 0) {
      return {
        chunks: [],
        quality: {
          classification: "empty",
          rawChunkCount: 0,
          eligibleChunkCount: 0,
          ineligibleChunkCount: 0,
          boilerplateRatio: 0,
          ineligibleReasonBreakdown: {},
        },
      };
    }

    const questionTokens = context?.question
      ? this.tokenize(context.question)
      : new Set<string>();
    const rubricTokens = context?.rubricText
      ? this.tokenize(context.rubricText)
      : new Set<string>();

    const pageTextCounts = this.buildPageTextCounts(chunks);
    const boilerplateTexts = this.detectBoilerplateTexts(pageTextCounts);

    const annotated: ExtractedChunk[] = chunks.map((chunk) => {
      const quality = this.classifyChunk(
        chunk,
        boilerplateTexts,
        questionTokens,
        rubricTokens,
      );
      return { ...chunk, quality };
    });

    const eligibleChunks = annotated.filter(
      (c) => c.quality?.eligibility === "eligible",
    );
    const ineligibleChunks = annotated.filter(
      (c) => c.quality?.eligibility === "ineligible",
    );

    const boilerplateCount = ineligibleChunks.filter((c) =>
      c.quality?.ineligibleReasons?.some(
        (r) => r === "boilerplate" || r === "page_label",
      ),
    ).length;
    const boilerplateRatio =
      chunks.length > 0 ? boilerplateCount / chunks.length : 0;

    const reasonBreakdown: Partial<Record<ChunkIneligibleReason, number>> = {};
    for (const chunk of ineligibleChunks) {
      for (const reason of chunk.quality?.ineligibleReasons ?? []) {
        reasonBreakdown[reason] = (reasonBreakdown[reason] ?? 0) + 1;
      }
    }

    const pageNumbers = this.extractPageNumbers(chunks);
    const pageCount = pageNumbers.size > 0 ? pageNumbers.size : undefined;

    const avgSubstantiveTokensPerPage =
      pageCount && pageCount > 0
        ? this.computeAvgSubstantiveTokensPerPage(eligibleChunks, pageNumbers)
        : undefined;

    const classification = this.classifySubmission({
      eligibleCount: eligibleChunks.length,
      totalChunks: chunks.length,
      boilerplateRatio,
      pageCount,
      avgSubstantiveTokensPerPage,
    });

    return {
      chunks: annotated,
      quality: {
        classification,
        rawChunkCount: chunks.length,
        eligibleChunkCount: eligibleChunks.length,
        ineligibleChunkCount: ineligibleChunks.length,
        boilerplateRatio,
        pageCount,
        avgSubstantiveTokensPerPage,
        ineligibleReasonBreakdown: reasonBreakdown,
      },
    };
  }

  private classifyChunk(
    chunk: ExtractedChunk,
    boilerplateTexts: Set<string>,
    questionTokens: Set<string>,
    rubricTokens: Set<string>,
  ): ChunkQuality {
    const reasons: ChunkIneligibleReason[] = [];
    const normalizedText = chunk.text.trim();
    const normalizedLower = normalizedText.toLowerCase();

    if (this.isMetadataBanner(normalizedLower)) {
      reasons.push("metadata_only");
    }

    if (this.isPageLabel(normalizedText)) {
      reasons.push("page_label");
    }

    if (reasons.length === 0 && boilerplateTexts.has(this.normalizeForDedup(normalizedText))) {
      reasons.push("boilerplate");
    }

    const substantiveTokens = this.getSubstantiveTokens(normalizedText);
    const substantiveTokenCount = substantiveTokens.size;

    if (
      reasons.length === 0 &&
      substantiveTokenCount < GRADING_QUALITY.MIN_SUBSTANTIVE_TOKENS
    ) {
      reasons.push("too_short");
    }

    if (reasons.length === 0 && questionTokens.size > 0) {
      const chunkTokens = this.tokenize(normalizedText);
      const sim = this.jaccardSimilarity(chunkTokens, questionTokens);
      if (sim >= GRADING_QUALITY.PROMPT_COPY_SIMILARITY_THRESHOLD) {
        reasons.push("prompt_copy");
      }
    }

    if (reasons.length === 0 && rubricTokens.size > 0) {
      const chunkTokens = this.tokenize(normalizedText);
      const sim = this.jaccardSimilarity(chunkTokens, rubricTokens);
      if (sim >= GRADING_QUALITY.RUBRIC_COPY_SIMILARITY_THRESHOLD) {
        reasons.push("rubric_copy");
      }
    }

    const eligibility: ChunkEligibility =
      reasons.length === 0 ? "eligible" : "ineligible";

    return {
      eligibility,
      ineligibleReasons: reasons.length > 0 ? reasons : undefined,
      substantiveTokenCount,
    };
  }

  private isPageLabel(text: string): boolean {
    return PAGE_LABEL_PATTERN.test(text.trim());
  }

  private isMetadataBanner(lowerText: string): boolean {
    for (const prefix of METADATA_BANNER_PREFIXES) {
      if (lowerText.startsWith(prefix)) return true;
    }
    // Metadata key-value lines are always short (e.g. "Title: My Doc").
    // Reject the pattern on long text to avoid false-positives on learner content
    // that begins with "Subject:", "Title:", "Author:", etc.
    return lowerText.length <= 80 && METADATA_KEY_PATTERN.test(lowerText);
  }

  private buildPageTextCounts(
    chunks: ExtractedChunk[],
  ): Map<string, Set<number>> {
    const pagesByText = new Map<string, Set<number>>();

    for (const chunk of chunks) {
      const pageNum = this.getChunkPage(chunk);
      if (pageNum === null) continue;

      const key = this.normalizeForDedup(chunk.text);
      if (!key) continue;

      const pages = pagesByText.get(key) ?? new Set<number>();
      pages.add(pageNum);
      pagesByText.set(key, pages);
    }

    return pagesByText;
  }

  private detectBoilerplateTexts(
    pageTextCounts: Map<string, Set<number>>,
  ): Set<string> {
    const boilerplate = new Set<string>();
    for (const [text, pages] of pageTextCounts) {
      if (pages.size >= GRADING_QUALITY.BOILERPLATE_REPEAT_MIN_PAGES) {
        boilerplate.add(text);
      }
    }
    return boilerplate;
  }

  private extractPageNumbers(chunks: ExtractedChunk[]): Set<number> {
    const pages = new Set<number>();
    for (const chunk of chunks) {
      const page = this.getChunkPage(chunk);
      if (page !== null) pages.add(page);
    }
    return pages;
  }

  private getChunkPage(chunk: ExtractedChunk): number | null {
    if (chunk.anchor.type === "file") return chunk.anchor.page;
    if (chunk.anchor.type === "image" && chunk.anchor.page !== undefined)
      return chunk.anchor.page;
    return null;
  }

  private computeAvgSubstantiveTokensPerPage(
    chunks: ExtractedChunk[],
    pageNumbers: Set<number>,
  ): number {
    if (pageNumbers.size === 0) return 0;

    const tokensByPage = new Map<number, number>();
    for (const page of pageNumbers) tokensByPage.set(page, 0);

    for (const chunk of chunks) {
      const page = this.getChunkPage(chunk);
      if (page === null || !tokensByPage.has(page)) continue;
      const tokens = this.getSubstantiveTokens(chunk.text).size;
      tokensByPage.set(page, (tokensByPage.get(page) ?? 0) + tokens);
    }

    const total = [...tokensByPage.values()].reduce((a, b) => a + b, 0);
    return total / pageNumbers.size;
  }

  private classifySubmission(params: {
    eligibleCount: number;
    totalChunks: number;
    boilerplateRatio: number;
    pageCount?: number;
    avgSubstantiveTokensPerPage?: number;
  }): SubmissionQualityClassification {
    if (params.totalChunks === 0 || params.eligibleCount === 0) {
      if (params.totalChunks === 0) return "empty";

      if (
        params.boilerplateRatio >= GRADING_QUALITY.BOILERPLATE_RATIO_FAIL &&
        (params.pageCount ?? 0) >= GRADING_QUALITY.MANY_PAGE_THRESHOLD
      ) {
        return "boilerplate_many_pages";
      }

      if (
        params.avgSubstantiveTokensPerPage !== undefined &&
        params.avgSubstantiveTokensPerPage <
          GRADING_QUALITY.LOW_INFORMATION_AVG_SUBSTANTIVE_TOKENS_PER_PAGE
      ) {
        if ((params.pageCount ?? 0) >= GRADING_QUALITY.MANY_PAGE_THRESHOLD) {
          return "low_information";
        }
      }

      return "empty";
    }

    if (
      params.boilerplateRatio >= GRADING_QUALITY.BOILERPLATE_RATIO_FAIL &&
      (params.pageCount ?? 0) >= GRADING_QUALITY.MANY_PAGE_THRESHOLD
    ) {
      return "boilerplate_many_pages";
    }

    if (
      params.avgSubstantiveTokensPerPage !== undefined &&
      params.avgSubstantiveTokensPerPage <
        GRADING_QUALITY.LOW_INFORMATION_AVG_SUBSTANTIVE_TOKENS_PER_PAGE &&
      (params.pageCount ?? 0) >= GRADING_QUALITY.MANY_PAGE_THRESHOLD
    ) {
      return "low_information";
    }

    return "clean";
  }

  private normalizeForDedup(text: string): string {
    return text
      .toLowerCase()
      .replaceAll(/\s+/g, " ")
      .trim();
  }

  private tokenize(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .replaceAll(/[^\s\w]/g, " ")
        .split(/\s+/)
        .filter(
          (token) =>
            token.length > 2 &&
            !/^\d+$/.test(token) &&
            !STOPWORDS.has(token),
        ),
    );
  }

  private getSubstantiveTokens(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .replaceAll(/[^\s\w]/g, " ")
        .split(/\s+/)
        .filter(
          (token) =>
            token.length > 1 &&
            !/^\d+$/.test(token) &&
            !STOPWORDS.has(token),
        ),
    );
  }

  private jaccardSimilarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    let intersection = 0;
    for (const token of a) {
      if (b.has(token)) intersection++;
    }
    const union = a.size + b.size - intersection;
    return intersection / union;
  }
}
