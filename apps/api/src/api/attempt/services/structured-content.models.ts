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

  imageData?: string;
  imageDescription?: string;
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
