/**
 * Highlighting models for learner response feedback
 * Provides visual indicators of correctness in text-based and file-based responses
 */

/**
 * Correctness level for a text segment
 */
export enum HighlightLevel {
  CORRECT = "correct",
  PARTIAL = "partial",
  INCORRECT = "incorrect",
  NEUTRAL = "neutral",
}

/**
 * A highlighted segment of text with AI feedback
 */
export interface TextHighlight {
  /** Start position in the text (character index) */
  start: number;

  /** End position in the text (character index) */
  end: number;

  /** The actual text content */
  text: string;

  /** Correctness level */
  level: HighlightLevel;

  /** AI comment/feedback for this segment */
  comment: string;

  /** Related criterion (optional) */
  criterionId?: string;

  /** Evidence citation ID (for file-based questions) */
  evidenceId?: string;
}

/**
 * Complete highlighting data for a response
 */
export interface ResponseHighlighting {
  /** Original response text */
  originalText: string;

  /** Highlighted segments */
  highlights: TextHighlight[];

  /** Overall correctness percentage */
  correctnessScore: number;

  /** Response type */
  responseType: "text" | "file";

  /** For file-based: page number */
  pageNumber?: number;

  /** For file-based: block ID */
  blockId?: string;
}

/**
 * Highlighting for file-based responses (per page/section)
 */
export interface FileHighlighting {
  /** File name */
  filename: string;

  /** Highlighting data per page/section - using Record for JSON serialization */
  pages: Record<number, ResponseHighlighting>;

  /** Block-level highlights (for structured content) - using Record for JSON serialization */
  blockHighlights: Record<string, TextHighlight[]>;
}

/**
 * Convert Maps to plain objects for JSON serialization
 */
export function serializeFileHighlighting(highlighting: {
  filename: string;
  pages: Map<number, ResponseHighlighting>;
  blockHighlights: Map<string, TextHighlight[]>;
}): FileHighlighting {
  const pagesObject: Record<number, ResponseHighlighting> = {};
  for (const [key, value] of highlighting.pages.entries()) {
    pagesObject[key] = value;
  }

  const blockHighlightsObject: Record<string, TextHighlight[]> = {};
  for (const [key, value] of highlighting.blockHighlights.entries()) {
    blockHighlightsObject[key] = value;
  }

  return {
    filename: highlighting.filename,
    pages: pagesObject,
    blockHighlights: blockHighlightsObject,
  };
}
