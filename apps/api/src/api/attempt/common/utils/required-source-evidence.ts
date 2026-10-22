import {
  SourceProcessingError,
  RetryableProcessingError,
  SourceProcessingReason,
} from "../../../llm/features/grading/errors/source-processing.error";
import type { ExtractedFileContent } from "../../services/file-content-extraction";
import { classifyFileProblem } from "./file-issue-classification";

// These are legacy extractor-generated placeholders, not evidence. Keep matches
// anchored so a learner discussing an extraction error is not rejected.
const EXTRACTION_PLACEHOLDER =
  /^(?:\[ERROR extracting |\[PDF FILE - EXTRACTION FAILED]|\[PDF - (?:FALLBACK|BASIC TEXT) EXTRACTION]|\[JUPYTER NOTEBOOK - FALLBACK EXTRACTION:|\[LEGACY DOC FILE: Extraction failed]|\[LEGACY DOC FILE]\s*Unable to extract text|\[BINARY CONTENT:)/;

// The storage object behind an upload is gone; the learner has to upload again.
const MISSING_UPLOAD_RE = /file is unavailable\. upload it again/i;

function blockFile(
  reason: SourceProcessingReason,
  index: number,
  file: ExtractedFileContent,
  failure: "extraction" | "no_content",
): never {
  const reference = `file:${index}`;
  if (file.error && MISSING_UPLOAD_RE.test(file.error)) {
    throw new SourceProcessingError(reason, reference, {
      code: "source_unreadable",
      source: { kind: "file", fileName: file.filename },
      message: `We couldn't find the uploaded copy of "${file.filename}". Upload the file again, then submit.`,
    });
  }
  const classification = classifyFileProblem({
    fileName: file.filename,
    failure,
    size: file.metadata?.size,
    sniffedType: file.metadata?.sniffedType,
    encrypted: file.metadata?.encrypted,
    errorMessage: file.error,
  });
  throw new SourceProcessingError(reason, reference, {
    code: classification.code,
    source: {
      kind: "file",
      fileName: file.filename,
      detectedType: classification.detectedType,
      expectedType: classification.expectedType,
    },
  });
}

/** All submitted files are required until an explicit optional-source policy exists. */
export function assertRequiredSourceEvidence(
  files: ExtractedFileContent[],
  expectedCount: number,
): void {
  if (files.length !== expectedCount) {
    throw new SourceProcessingError("extraction_failed", "files", {
      code: "source_unreadable",
      source: { kind: "file" },
    });
  }
  for (const [index, file] of files.entries()) {
    const reference = `file:${index}`;
    if (file.error !== undefined && file.retryable) {
      throw new RetryableProcessingError("source_unavailable", reference);
    }
    if (file.error !== undefined || file.metadata?.extractionFailed) {
      blockFile("extraction_failed", index, file, "extraction");
    }
    if (EXTRACTION_PLACEHOLDER.test(file.content?.trim() ?? "")) {
      blockFile("extraction_failed", index, file, "extraction");
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
      blockFile("insufficient_source_evidence", index, file, "no_content");
    }
  }
}
