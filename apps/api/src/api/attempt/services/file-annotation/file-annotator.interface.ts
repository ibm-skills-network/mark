import { FileHighlighting } from "../../../llm/model/highlighting.model";

/**
 * File type categories for annotation
 */
export enum FileCategory {
  PDF = "pdf",
  IMAGE = "image",
  DOCUMENT = "document",
  CODE = "code",
  TEXT = "text",
  SPREADSHEET = "spreadsheet",
  PRESENTATION = "presentation",
}

/**
 * Annotation options
 */
export interface AnnotationOptions {
  studentName?: string;
  includeHeader?: boolean;
  includeSummary?: boolean;
  outputFormat?: "pdf" | "html" | "image";
  colorScheme?: "standard" | "colorblind-safe" | "high-contrast";
}

/**
 * Annotation result
 */
export interface AnnotationResult {
  buffer: Buffer;
  mimeType: string;
  filename: string;
  metadata?: {
    highlightCount?: number;
    pageCount?: number;
    annotationMethod?: string;
  };
}

/**
 * Interface for file annotators
 * Each file type (PDF, image, code, etc.) implements this interface
 */
export interface IFileAnnotator {
  /**
   * Check if this annotator can handle the given file type
   */
  canHandle(mimeType: string, filename: string): boolean;

  /**
   * Annotate a file with AI feedback
   * @param fileBuffer Original file buffer
   * @param highlighting Highlighting data from grading
   * @param options Annotation options
   * @returns Annotated file result
   */
  annotate(
    fileBuffer: Buffer,
    highlighting: FileHighlighting,
    options?: AnnotationOptions,
  ): Promise<AnnotationResult>;

  /**
   * Get the category this annotator handles
   */
  getCategory(): FileCategory;
}
