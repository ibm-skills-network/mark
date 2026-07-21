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

const COPY_LABEL_TOKENS = new Set(["answer", "response"]);

const PAGE_LABEL_PATTERN =
  /^-?\s*(page\s+)?\d+(\s*[/-]\s*\d+|\s+of\s+\d+)?\s*-?\.?$/i;

// Banner → ineligible reason. Generated summaries and system validator
// reports get distinct reasons so audits can tell them apart from plain
// extraction metadata (see ../grading-policy.ts for the evidence policy).
const BANNER_REASONS: Array<{ prefix: string; reason: ChunkIneligibleReason }> =
  [
    { prefix: "=== pdf document ===", reason: "metadata_only" },
    { prefix: "--- content ---", reason: "metadata_only" },
    { prefix: "=== generated summary ===", reason: "generated_summary" },
    { prefix: "=== validator report ===", reason: "non_learner_source" },
  ];

const METADATA_KEY_PATTERN =
  /^(pages|title|creator|author|subject|keywords)\s*:/i;

// FileGradingService adds this deterministic block when it has to reconstruct
// structured content from extracted text. It is system provenance, not learner
// evidence. Match the complete set of generated keys (and every line) rather
// than treating arbitrary learner text beginning with "Filename:" as metadata.
const FILE_METADATA_LINE_PATTERN =
  /^(filename|file type|mime type|file size|sheet count|page count|file hash|content extracted)\s*:/i;

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

// Block types whose content is meaningful even when very short (a code
// statement, a table cell, an equation) — exempt from the too_short check.
const STRUCTURAL_BLOCK_TYPES = new Set([
  "table",
  "code",
  "list",
  "equation",
  "quote",
  "image",
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
    const rubricTextsSource =
      context?.rubricTexts ?? (context?.rubricText ? [context.rubricText] : []);
    const perCriterionRubricTokenSets: Set<string>[] = rubricTextsSource
      .map((t) => this.tokenize(t))
      .filter((s) => s.size >= GRADING_QUALITY.RUBRIC_COPY_MIN_TOKENS);

    const pageTextCounts = this.buildPageTextCounts(chunks);
    const textRepeatCounts = this.buildTextRepeatCounts(chunks);
    const boilerplateTexts = this.detectBoilerplateTexts(
      pageTextCounts,
      textRepeatCounts,
    );

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
      const page = this.getChunkPageKey(chunk);
      if (
        page !== null &&
        headingOnlyPages.has(page) &&
        chunk.quality?.eligibility === "eligible"
      ) {
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
    const allPageKeys = this.extractPageKeys(chunks);
    const pageCount = allPageKeys.size > 0 ? allPageKeys.size : undefined;

    // Avg tokens per page: prefer eligible-chunk pages for the density signal.
    // When all chunks are ineligible (eligibleCount === 0), fall back to all chunks
    // so the low_information classifier can still fire — otherwise it is dead code.
    const eligiblePageKeys = this.extractPageKeys(eligibleChunks);
    const avgSubstantiveTokensPerPage =
      eligiblePageKeys.size > 0
        ? this.computeAvgSubstantiveTokensPerPage(
            eligibleChunks,
            eligiblePageKeys,
          )
        : allPageKeys.size > 0
          ? this.computeAvgSubstantiveTokensPerPage(annotated, allPageKeys)
          : undefined;

    const classification = this.classifySubmission({
      eligibleCount: eligibleChunks.length,
      totalChunks: chunks.length,
      boilerplateRatio,
      pageCount,
      avgSubstantiveTokensPerPage,
      hasVisualContent: chunks.some((chunk) => this.isVisualChunk(chunk)),
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
      parameters.classification === "low_information" ||
      parameters.classification === "needs_visual_evidence"
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

    const bannerReason = this.getBannerReason(normalizedLower);
    if (bannerReason) {
      reasons.push(bannerReason);
    }

    if (this.isPageLabel(chunk, normalizedText)) {
      reasons.push("page_label");
    }

    if (
      reasons.length === 0 &&
      boilerplateTexts.has(this.getSourceTextKey(chunk))
    ) {
      reasons.push("boilerplate");
    }

    const substantiveTokenCount =
      this.getSubstantiveTokens(normalizedText).size;

    // too_short is a noise floor for prose only; structural and visual chunks
    // (code, tables, lists, equations, quotes, images/OCR) can be legitimately
    // terse and are never rejected for length. See ../grading-policy.ts.
    if (
      reasons.length === 0 &&
      !this.isStructuralChunk(chunk) &&
      !this.isVisualChunk(chunk) &&
      !this.hasUnpagedNumericSignal(chunk, normalizedText) &&
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
      if (
        sim >= GRADING_QUALITY.PROMPT_COPY_SIMILARITY_THRESHOLD &&
        !this.hasNovelLearnerTokens(chunkTokens, questionTokens)
      ) {
        reasons.push("prompt_copy");
      }
    }

    if (reasons.length === 0 && perCriterionRubricTokenSets.length > 0) {
      chunkTokens ??= this.tokenize(normalizedText);
      // Flag rubric_copy if the chunk is too similar to ANY individual criterion —
      // not the union of all criteria, which would inflate the denominator.
      const isRubricCopy = perCriterionRubricTokenSets.some(
        (criterionTokens) =>
          this.jaccardSimilarity(chunkTokens, criterionTokens) >=
            GRADING_QUALITY.RUBRIC_COPY_SIMILARITY_THRESHOLD &&
          !this.hasNovelLearnerTokens(chunkTokens, criterionTokens),
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

  private isPageLabel(chunk: ExtractedChunk, text: string): boolean {
    const hasPageContext =
      chunk.anchor.type === "file" ||
      (chunk.anchor.type === "image" && chunk.anchor.page !== undefined);
    return hasPageContext && PAGE_LABEL_PATTERN.test(text.trim());
  }

  /**
   * Numeric short answers have no lexical tokens after tokenization, but can
   * still be complete learner evidence. Let the criterion validator judge
   * them for unpaged text/URL submissions instead of dropping them as noise.
   */
  private hasUnpagedNumericSignal(
    chunk: ExtractedChunk,
    text: string,
  ): boolean {
    const isUnpagedSource =
      chunk.anchor.type === "text" || chunk.anchor.type === "url";
    return isUnpagedSource && /\d/.test(text);
  }

  private getBannerReason(lowerText: string): ChunkIneligibleReason | null {
    for (const { prefix, reason } of BANNER_REASONS) {
      // The extraction content separator can share a paragraph with the first
      // learner-content line. In that case the whole chunk is evidence; only
      // the standalone separator is metadata. Other banners introduce blocks
      // that remain system-authored in their entirety (summary/report/PDF
      // metadata), so prefix matching is intentional for those.
      if (
        (prefix === "--- content ---" && lowerText === prefix) ||
        (prefix !== "--- content ---" && lowerText.startsWith(prefix))
      ) {
        return reason;
      }
    }
    const lines = lowerText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (
      lines.length >= 2 &&
      lines.every((line) => FILE_METADATA_LINE_PATTERN.test(line)) &&
      lines.some((line) => /^filename\s*:\s*\S/i.test(line)) &&
      lines.some((line) => /^content extracted\s*:\s*(yes|no)\s*$/i.test(line))
    ) {
      return "metadata_only";
    }
    // Metadata key-value lines are always short (e.g. "Title: My Doc").
    // Reject the pattern on long text to avoid false-positives on learner content
    // that begins with "Subject:", "Title:", "Author:", etc.
    return lowerText.length <= 80 && METADATA_KEY_PATTERN.test(lowerText)
      ? "metadata_only"
      : null;
  }

  private isStructuralChunk(chunk: ExtractedChunk): boolean {
    const blockType = chunk.metadata?.blockType;
    return blockType !== undefined && STRUCTURAL_BLOCK_TYPES.has(blockType);
  }

  private isVisualChunk(chunk: ExtractedChunk): boolean {
    return chunk.anchor.type === "image" || chunk.sourceType === "image";
  }

  // A heading-only page has chunks exclusively of type "heading" with no
  // paragraph, table, code, list, equation, quote, or image blocks.
  // Only processes chunks that have an explicit blockType in metadata —
  // chunks without blockType (text/url sources) are skipped so they never
  // trigger false heading-only flags.
  private detectHeadingOnlyPages(chunks: ExtractedChunk[]): Set<string> {
    const pageHasSubstantive = new Map<string, boolean>();
    const pageHasKnownBlock = new Map<string, boolean>();

    for (const chunk of chunks) {
      const page = this.getChunkPageKey(chunk);
      if (page === null) continue;

      const blockType = chunk.metadata?.blockType;
      if (!blockType) continue; // only act on chunks with explicit block type

      pageHasKnownBlock.set(page, true);
      if (SUBSTANTIVE_BLOCK_TYPES.has(blockType)) {
        pageHasSubstantive.set(page, true);
      }
    }

    const headingOnly = new Set<string>();
    for (const [page] of pageHasKnownBlock) {
      if (!pageHasSubstantive.get(page)) {
        headingOnly.add(page);
      }
    }
    return headingOnly;
  }

  private buildPageTextCounts(
    chunks: ExtractedChunk[],
  ): Map<string, Set<string>> {
    const pagesByText = new Map<string, Set<string>>();

    for (const chunk of chunks) {
      const pageKey = this.getChunkPageKey(chunk);
      if (pageKey === null) continue;

      const key = this.getSourceTextKey(chunk);
      if (!key) continue;

      const pages = pagesByText.get(key) ?? new Set<string>();
      pages.add(pageKey);
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
      const key = this.getSourceTextKey(chunk);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }

  private detectBoilerplateTexts(
    pageTextCounts: Map<string, Set<string>>,
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

  private extractPageKeys(chunks: ExtractedChunk[]): Set<string> {
    const pages = new Set<string>();
    for (const chunk of chunks) {
      const page = this.getChunkPageKey(chunk);
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

  private getChunkPageKey(chunk: ExtractedChunk): string | null {
    const page = this.getChunkPage(chunk);
    return page === null
      ? null
      : `${chunk.sourceType}\u0000${chunk.sourceId}\u0000${page}`;
  }

  private getSourceTextKey(chunk: ExtractedChunk): string {
    const text = this.normalizeForDedup(chunk.text);
    return text
      ? `${chunk.sourceType}\u0000${chunk.sourceId}\u0000${text}`
      : "";
  }

  private computeAvgSubstantiveTokensPerPage(
    chunks: ExtractedChunk[],
    pageKeys: Set<string>,
  ): number {
    if (pageKeys.size === 0) return 0;

    const tokensByPage = new Map<string, number>();
    for (const page of pageKeys) tokensByPage.set(page, 0);

    for (const chunk of chunks) {
      const page = this.getChunkPageKey(chunk);
      if (page === null || !tokensByPage.has(page)) continue;
      // Ineligible chunks (including heading-only re-marked ones) contribute 0 tokens
      // so their preserved substantiveTokenCount doesn't inflate the density average.
      const tokens =
        chunk.quality?.eligibility === "ineligible"
          ? 0
          : (chunk.quality?.substantiveTokenCount ??
            this.getSubstantiveTokens(chunk.text).size);
      tokensByPage.set(page, (tokensByPage.get(page) ?? 0) + tokens);
    }

    let total = 0;
    for (const v of tokensByPage.values()) total += v;
    return total / pageKeys.size;
  }

  private classifySubmission(parameters: {
    eligibleCount: number;
    totalChunks: number;
    boilerplateRatio: number;
    pageCount?: number;
    avgSubstantiveTokensPerPage?: number;
    hasVisualContent?: boolean;
  }): SubmissionQualityClassification {
    if (parameters.totalChunks === 0) return "empty";

    // Rejection-level classifications only apply when there are NO eligible chunks.
    // When eligible chunks exist, grading proceeds and the classification is "clean"
    // regardless of boilerplate ratio — quality signal is surfaced via qualityWarnings.
    if (parameters.eligibleCount === 0) {
      if (
        parameters.boilerplateRatio >= GRADING_QUALITY.BOILERPLATE_RATIO_FAIL
      ) {
        return "boilerplate_many_pages";
      }

      // Visual content is present but produced no eligible evidence (e.g. OCR
      // matched boilerplate or the prompt). Flags that manual/visual review
      // could still find gradable work.
      if (parameters.hasVisualContent) {
        return "needs_visual_evidence";
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
    return text.toLowerCase().replaceAll(/\s+/g, " ").trim();
  }

  private tokenize(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .replaceAll(/[^\s\w]/g, " ")
        .split(/\s+/)
        .filter(
          (token) =>
            token.length > 2 && !/^\d+$/.test(token) && !STOPWORDS.has(token),
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
            token.length > 1 && !/^\d+$/.test(token) && !STOPWORDS.has(token),
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

  private hasNovelLearnerTokens(
    candidate: Set<string>,
    reference: Set<string>,
  ): boolean {
    for (const token of candidate) {
      if (!reference.has(token) && !COPY_LABEL_TOKENS.has(token)) return true;
    }
    return false;
  }
}
