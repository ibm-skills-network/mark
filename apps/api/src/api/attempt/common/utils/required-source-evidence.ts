import {
  SourceProcessingError,
  RetryableProcessingError,
} from "../../../llm/features/grading/errors/source-processing.error";
import type { ExtractedFileContent } from "../../services/file-content-extraction";

// These are legacy extractor-generated placeholders, not evidence. Keep matches
// anchored so a learner discussing an extraction error is not rejected.
const EXTRACTION_PLACEHOLDER =
  /^(?:\[ERROR extracting |\[PDF FILE - EXTRACTION FAILED]|\[PDF - (?:FALLBACK|BASIC TEXT) EXTRACTION]|\[JUPYTER NOTEBOOK - FALLBACK EXTRACTION:|\[LEGACY DOC FILE: Extraction failed]|\[LEGACY DOC FILE]\s*Unable to extract text|\[BINARY CONTENT:)/;

/** All submitted files are required until an explicit optional-source policy exists. */
export function assertRequiredSourceEvidence(
  files: ExtractedFileContent[],
  expectedCount: number,
): void {
  if (files.length !== expectedCount) {
    throw new SourceProcessingError("extraction_failed", "files");
  }
  for (const [index, file] of files.entries()) {
    const reference = `file:${index}`;
    if (file.error !== undefined && file.retryable) {
      throw new RetryableProcessingError("source_unavailable", reference);
    }
    if (file.error !== undefined || file.metadata?.extractionFailed) {
      throw new SourceProcessingError("extraction_failed", reference);
    }
    if (EXTRACTION_PLACEHOLDER.test(file.content?.trim() ?? "")) {
      throw new SourceProcessingError("extraction_failed", reference);
    }
    // Visual evidence is valid without extracted text. A placeholder alone is not.
    const hasVision = file.useVisionMode && !!file.fileUrl;
    const hasBlocks = file.structuredContent?.pages?.some(
      (page) => page.blocks.length > 0,
    );
    const isEmptyTextFile =
      file.metadata?.size === 0 && file.fileType.startsWith("text/");
    if (
      !hasVision &&
      !hasBlocks &&
      !isEmptyTextFile &&
      (file.structuredContent || !file.content?.trim())
    ) {
      throw new SourceProcessingError(
        "insufficient_source_evidence",
        reference,
      );
    }
  }
}
