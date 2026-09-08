/**
 * Structured content models for evidence-based grading
 *
 * These models enforce:
 * - Completeness: Every part of the submission is preserved
 * - Determinism: Same input → same structure
 * - Traceability: Every piece of content has a citation (page, blockId)
 */
import { FileHighlighting } from "../../llm/model/highlighting.model";

/**
 * Bounding box for precise content location
 */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Content block types
 */
export type BlockType =
  | "heading"
  | "paragraph"
  | "table"
  | "code"
  | "equation"
  | "list"
  | "quote"
  | "image"
  | "unknown";

/**
 * Table structure
 */
export interface TableBlock {
  rows: string[][];
  headers?: string[];
}

/**
 * A single content block within a page
 * This is the atomic unit for evidence citation
 */
export interface ContentBlock {
  blockId: string;
  type: BlockType;
  text: string;
  bbox?: BoundingBox;
  page: number;

  language?: string;
  table?: TableBlock;
  latex?: string;
  level?: number;

  /**
   * Always surface this block to the evidence validator, even when lexical
   * retrieval doesn't rank it (e.g. the whole-file block for code uploads,
   * whose correctness/style criteria concern the entire submission).
   */
  pinnedEvidence?: boolean;

  /**
   * For submissions that bundle several files (archives), the member file
   * this block came from. Evidence chunking prefers it over the
   * submission-level id so per-file handling (code quote caps) applies.
   */
  sourceFilename?: string;

  /**
   * Grading-time note about what this block's output actually looks like, set
   * once an image it produced has been described. NOT learner content: it is
   * appended when building chunk text so retrieval and validation can see it,
   * while `text` stays exactly what the learner submitted.
   */
  renderedOutputNote?: string;

  imageData?: string;
  imageDescription?: string;
  /**
   * blockId of the block whose execution produced this image, where the
   * extractor knows the relationship (a notebook cell and its plots). Absent
   * when it does not: PDF pages list every text block before every image, so
   * position implies nothing about which text produced which figure.
   */
  producedByBlockId?: string;
  /**
   * Content digest of the image bytes. Two blocks carrying the same picture
   * share a hash, so the vision step can describe it once and reuse the result
   * (notebooks re-run cells constantly and emit the identical plot each time).
   */
  imageHash?: string;
  imageMetadata?: {
    width: number;
    height: number;
    format: string;
  };
}

/**
 * A single page with ordered blocks
 * Preserves reading order
 */
export interface StructuredPage {
  pageNumber: number;
  blocks: ContentBlock[];
  metadata?: {
    width?: number;
    height?: number;
    rotation?: number;
  };
}

/**
 * A detected section within the document
 * Sections help organize content but are NOT used for grading decisions
 */
export interface DocumentSection {
  sectionId: string;
  title: string;
  pages: number[];
  contentBlocks: string[];
  level?: number;
}

/**
 * Complete canonical submission structure
 * This is what the grading engine receives
 */
export interface CanonicalSubmission {
  submissionId: string;
  metadata: {
    wordCount: number;
    pageCount: number;
    blockCount: number;
    detectedSections?: string[];
    sourceType: "pdf" | "docx" | "txt" | "md" | "ipynb";
    checksum: string;
    extractedAt: string;
  };
  pages: StructuredPage[];
  sections?: DocumentSection[];
}

/**
 * Evidence citation for grading
 * Links a score to specific content
 */
export interface EvidenceCitation {
  blockId: string;
  quote: string;
  page: number;
  relevance?: string;
}

/**
 * Criterion-level grading result
 * One per rubric criterion
 */
export interface CriterionGradingResult {
  criterionId: string;
  rubricQuestion: string;
  pointsAwarded: number;
  maxPoints: number;

  evidence: EvidenceCitation[];

  rationale: string;

  nextStep?: string;

  decision: "meets" | "partially_meets" | "does_not_meet";

  gradedAt: string;
}

/**
 * Complete grading result with evidence chain
 */
export interface EvidenceBasedGradingResult {
  submissionId: string;
  totalPoints: number;
  maxPossiblePoints: number;

  criteriaResults: CriterionGradingResult[];

  feedback: {
    summary: string;
    strengths: string[];
    improvements: string[];
  };

  highlighting?: FileHighlighting;

  metadata: {
    gradedAt: string;
    modelUsed: string;
    determinismChecksum: string;
    auditLog?: unknown;
  };
}

/**
 * Extraction metadata for debugging
 */
export interface ExtractionMetadata {
  extractionMethod: "pdfjs" | "pdf-parse" | "mammoth" | "fallback";
  extractionDuration: number;
  warnings: string[];
  structureQuality: "high" | "medium" | "low";
}
