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
  /** Single concatenated rubric string — use rubricTexts instead for multi-criterion rubrics. */
  rubricText?: string;
  /** Per-criterion rubric texts — Jaccard is checked against each criterion individually. */
  rubricTexts?: string[];
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
  /^-?\s*(page\s+)?\d+(\s*[/-]\s*\d+|\s+of\s+\d+)?\s*-?\.?$/i;

const METADATA_BANNER_PREFIXES = [
  "=== pdf document ===",
  "--- content ---",
  "=== generated summary ===",
  "=== validator report ===",
];

const METADATA_KEY_PATTERN = /^(pages|title|creator|author|subject|keywords)\s*:/i;

// "unknown" is included so unrecognised block types don't falsely trigger heading-only detection.
const SUBSTANTIVE_BLOCK_TYPES = new Set([
  "paragraph",
  "table",
  "code",
  "list",
  "equation",
  "quote",
  "image",
  "unknown",
]);

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
          gated: false,
          qualityWarnings: [],
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

    // Build per-criterion token sets for rubric_copy detection. Checking each criterion
    // independently prevents the union-set denominator from growing so large that no
    // realistic learner answer can reach the 0.85 Jaccard threshold.
    const rubricTextsSource = context?.rubricTexts ?? (context?.rubricText ? [context.rubricText] : []);
    const perCriterionRubricTokenSets: Set<string>[] = rubricTextsSource
      .map((t) => this.tokenize(t))
      .filter((s) => s.size >= GRADING_QUALITY.RUBRIC_COPY_MIN_TOKENS);

    const pageTextCounts = this.buildPageTextCounts(chunks);
    const textRepeatCounts = this.buildTextRepeatCounts(chunks);
    const boilerplateTexts = this.detectBoilerplateTexts(pageTextCounts, textRepeatCounts);

    const perChunkAnnotated: ExtractedChunk[] = chunks.map((chunk) => {
      const quality = this.classifyChunk(
        chunk,
        boilerplateTexts,
        questionTokens,
        perCriterionRubricTokenSets,
      );
      return { ...chunk, quality };
    });

    const headingOnlyPages = this.detectHeadingOnlyPages(perChunkAnnotated);

    // Re-mark chunks on heading-only pages as ineligible (unless already ineligible).
    const annotated: ExtractedChunk[] = perChunkAnnotated.map((chunk) => {
      const page = this.getChunkPage(chunk);
      if (page !== null && headingOnlyPages.has(page) && chunk.quality?.eligibility === "eligible") {
        return {
          ...chunk,
          quality: {
            ...chunk.quality,
            eligibility: "ineligible" as const,
            ineligibleReasons: ["heading_only_page" as const],
          },
        };
      }
      return chunk;
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

    // pageCount uses ALL chunks so the threshold check (>= 25 pages) works even
    // when every chunk is ineligible (e.g. poison PDFs with zero eligible content).
    const allPageNumbers = this.extractPageNumbers(chunks);
    const pageCount = allPageNumbers.size > 0 ? allPageNumbers.size : undefined;

    // Avg tokens per page: prefer eligible-chunk pages for the density signal.
    // When all chunks are ineligible (eligibleCount === 0), fall back to all chunks
    // so the low_information classifier can still fire — otherwise it is dead code.
    const eligiblePageNumbers = this.extractPageNumbers(eligibleChunks);
    const avgSubstantiveTokensPerPage =
      eligiblePageNumbers.size > 0
        ? this.computeAvgSubstantiveTokensPerPage(eligibleChunks, eligiblePageNumbers)
        : allPageNumbers.size > 0
          ? this.computeAvgSubstantiveTokensPerPage(annotated, allPageNumbers)
          : undefined;

    const classification = this.classifySubmission({
      eligibleCount: eligibleChunks.length,
      totalChunks: chunks.length,
      boilerplateRatio,
      pageCount,
      avgSubstantiveTokensPerPage,
    });

    const qualityWarnings = this.buildWarnings({
      ineligibleCount: ineligibleChunks.length,
      totalChunks: chunks.length,
      boilerplateRatio,
      reasonBreakdown,
      classification,
    });

    return {
      chunks: annotated,
      quality: {
        classification,
        gated: false, // pipeline sets this to true when it short-circuits
        qualityWarnings,
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

  private buildWarnings(parameters: {
    ineligibleCount: number;
    totalChunks: number;
    boilerplateRatio: number;
    reasonBreakdown: Partial<Record<ChunkIneligibleReason, number>>;
    classification: SubmissionQualityClassification;
  }): string[] {
    const warnings: string[] = [];
    if (parameters.ineligibleCount > 0) {
      warnings.push(
        `${parameters.ineligibleCount}/${parameters.totalChunks} chunks excluded as ineligible`,
      );
    }
    if (parameters.boilerplateRatio >= 0.5) {
      warnings.push(
        `High boilerplate ratio: ${Math.round(parameters.boilerplateRatio * 100)}%`,
      );
    }
    if (parameters.reasonBreakdown.prompt_copy) {
      warnings.push(
        `${parameters.reasonBreakdown.prompt_copy} chunk(s) matched question text (prompt_copy)`,
      );
    }
    if (parameters.reasonBreakdown.rubric_copy) {
      warnings.push(
        `${parameters.reasonBreakdown.rubric_copy} chunk(s) matched rubric text (rubric_copy)`,
      );
    }
    if (parameters.reasonBreakdown.heading_only_page) {
      warnings.push(
        `${parameters.reasonBreakdown.heading_only_page} chunk(s) on heading-only pages (no body content)`,
      );
    }
    if (
      parameters.classification === "boilerplate_many_pages" ||
      parameters.classification === "low_information"
    ) {
      warnings.push(`Submission classified as ${parameters.classification}`);
    }
    return warnings;
  }

  private classifyChunk(
    chunk: ExtractedChunk,
    boilerplateTexts: Set<string>,
    questionTokens: Set<string>,
    perCriterionRubricTokenSets: Set<string>[],
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

    const substantiveTokenCount = this.getSubstantiveTokens(normalizedText).size;

    if (
      reasons.length === 0 &&
      substantiveTokenCount < GRADING_QUALITY.MIN_SUBSTANTIVE_TOKENS
    ) {
      reasons.push("too_short");
    }

    // Lazily compute chunkTokens — used by both prompt_copy and rubric_copy checks.
    let chunkTokens: Set<string> | undefined;

    if (
      reasons.length === 0 &&
      questionTokens.size >= GRADING_QUALITY.PROMPT_COPY_MIN_TOKENS
    ) {
      chunkTokens = this.tokenize(normalizedText);
      const sim = this.jaccardSimilarity(chunkTokens, questionTokens);
      if (sim >= GRADING_QUALITY.PROMPT_COPY_SIMILARITY_THRESHOLD) {
        reasons.push("prompt_copy");
      }
    }

    if (reasons.length === 0 && perCriterionRubricTokenSets.length > 0) {
      chunkTokens ??= this.tokenize(normalizedText);
      // Flag rubric_copy if the chunk is too similar to ANY individual criterion —
      // not the union of all criteria, which would inflate the denominator.
      const isRubricCopy = perCriterionRubricTokenSets.some(
        (criterionTokens) =>
          this.jaccardSimilarity(chunkTokens!, criterionTokens) >=
          GRADING_QUALITY.RUBRIC_COPY_SIMILARITY_THRESHOLD,
      );
      if (isRubricCopy) reasons.push("rubric_copy");
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

  // A heading-only page has chunks exclusively of type "heading" with no
  // paragraph, table, code, list, equation, quote, or image blocks.
  // Only processes chunks that have an explicit blockType in metadata —
  // chunks without blockType (text/url sources) are skipped so they never
  // trigger false heading-only flags.
  private detectHeadingOnlyPages(chunks: ExtractedChunk[]): Set<number> {

    const pageHasSubstantive = new Map<number, boolean>();
    const pageHasKnownBlock = new Map<number, boolean>();

    for (const chunk of chunks) {
      const page = this.getChunkPage(chunk);
      if (page === null) continue;

      const blockType = chunk.metadata?.blockType;
      if (!blockType) continue; // only act on chunks with explicit block type

      pageHasKnownBlock.set(page, true);
      if (SUBSTANTIVE_BLOCK_TYPES.has(blockType)) {
        pageHasSubstantive.set(page, true);
      }
    }

    const headingOnly = new Set<number>();
    for (const [page] of pageHasKnownBlock) {
      if (!pageHasSubstantive.get(page)) {
        headingOnly.add(page);
      }
    }
    return headingOnly;
  }

  private buildPageTextCounts(
    chunks: ExtractedChunk[],
  ): Map<string, Set<number>> {
    const pagesByText = new Map<string, Set<number>>();

    for (const chunk of chunks) {
      const pageNumber = this.getChunkPage(chunk);
      if (pageNumber === null) continue;

      const key = this.normalizeForDedup(chunk.text);
      if (!key) continue;

      const pages = pagesByText.get(key) ?? new Set<number>();
      pages.add(pageNumber);
      pagesByText.set(key, pages);
    }

    return pagesByText;
  }

  // For text/url chunks only, count raw repetitions for boilerplate detection.
  // Image chunks (pageless or not) are excluded: identical OCR text across
  // multiple images (e.g. same header or logo) is not a sign of boilerplate.
  private buildTextRepeatCounts(chunks: ExtractedChunk[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const chunk of chunks) {
      if (chunk.anchor.type !== "text" && chunk.anchor.type !== "url") continue;
      const key = this.normalizeForDedup(chunk.text);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }

  private detectBoilerplateTexts(
    pageTextCounts: Map<string, Set<number>>,
    textRepeatCounts: Map<string, number>,
  ): Set<string> {
    const boilerplate = new Set<string>();
    for (const [text, pages] of pageTextCounts) {
      if (pages.size >= GRADING_QUALITY.BOILERPLATE_REPEAT_MIN_PAGES) {
        boilerplate.add(text);
      }
    }
    for (const [text, count] of textRepeatCounts) {
      if (count >= GRADING_QUALITY.BOILERPLATE_REPEAT_MIN_TEXT) {
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
      // Reuse already-computed count from classifyChunk to avoid a second tokenization pass.
      const tokens = chunk.quality?.substantiveTokenCount ?? this.getSubstantiveTokens(chunk.text).size;
      tokensByPage.set(page, (tokensByPage.get(page) ?? 0) + tokens);
    }

    const total = [...tokensByPage.values()].reduce((a, b) => a + b, 0);
    return total / pageNumbers.size;
  }

  private classifySubmission(parameters: {
    eligibleCount: number;
    totalChunks: number;
    boilerplateRatio: number;
    pageCount?: number;
    avgSubstantiveTokensPerPage?: number;
  }): SubmissionQualityClassification {
    if (parameters.totalChunks === 0) return "empty";

    // Rejection-level classifications only apply when there are NO eligible chunks.
    // When eligible chunks exist, grading proceeds and the classification is "clean"
    // regardless of boilerplate ratio — quality signal is surfaced via qualityWarnings.
    if (parameters.eligibleCount === 0) {
      if (parameters.boilerplateRatio >= GRADING_QUALITY.BOILERPLATE_RATIO_FAIL) {
        return "boilerplate_many_pages";
      }

      if (
        parameters.avgSubstantiveTokensPerPage !== undefined &&
        parameters.avgSubstantiveTokensPerPage <
          GRADING_QUALITY.LOW_INFORMATION_AVG_SUBSTANTIVE_TOKENS_PER_PAGE
      ) {
        return "low_information";
      }

      return "empty";
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
