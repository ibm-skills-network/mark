/**
 * Thrown when an uploaded file yields no gradable text: either its format is
 * one we have no extractor for, or every extraction strategy fell through to
 * the binary/unrecognized fallbacks.
 *
 * Without this, the fallback's output — a handful of ASCII fragments scraped
 * out of a compressed archive — is passed to the model as if it were the
 * learner's work. The model cannot find anything to credit, so every criterion
 * is scored zero and the learner is penalised for a format we never supported.
 * Failing here converts that silent wrong grade into an actionable message.
 *
 * Terminal by construction: re-running the same bytes through the same
 * extractors cannot produce a different result.
 *
 * The fields are exposed as own enumerable properties so the project logger
 * can serialize them as structured context without leaking the message.
 */
import { LearnerFacingGradingError } from "./learner-facing-grading.error";

export type UnextractableReason =
  /** Extension is on the known-unsupported list — no extractor was tried. */
  | "unsupported_format"
  /** Every strategy fell through to a binary or unrecognized-bytes dump. */
  | "binary_content"
  /** An extractor ran but produced too little text to grade against. */
  | "insufficient_text";

export interface UnextractableSubmissionErrorFields {
  filename: string;
  reason: UnextractableReason;
  extension?: string;
  extractedLength?: number;
  questionId?: number;
  attemptId?: number;
}

/** Formats learners commonly submit that no extractor in this service handles. */
const CONVERSION_GUIDANCE: Record<string, string> = {
  numbers: "Excel (.xlsx) or CSV",
  pages: "Word (.docx) or PDF",
  key: "PowerPoint (.pptx) or PDF",
};

export class UnextractableSubmissionError extends LearnerFacingGradingError {
  public readonly filename: string;
  public readonly reason: UnextractableReason;
  public readonly extension?: string;
  public readonly extractedLength?: number;
  public readonly questionId?: number;
  public readonly attemptId?: number;

  constructor(fields: UnextractableSubmissionErrorFields) {
    super(
      `No gradable text could be extracted from "${fields.filename}" (reason=${
        fields.reason
      }, extension=${fields.extension ?? "none"}, extractedLength=${
        fields.extractedLength ?? 0
      }).`,
    );
    this.name = "UnextractableSubmissionError";
    this.filename = fields.filename;
    this.reason = fields.reason;
    this.extension = fields.extension;
    this.extractedLength = fields.extractedLength;
    this.questionId = fields.questionId;
    this.attemptId = fields.attemptId;

    // Restore the prototype chain when extending built-in Error so that
    // `instanceof` works correctly under the project's TypeScript target.
    Object.setPrototypeOf(this, UnextractableSubmissionError.prototype);
  }

  /**
   * Message safe to show a learner in the grading modal. Names the file and the
   * action that fixes it; extraction internals stay in `message` and the logs.
   */
  get learnerMessage(): string {
    const guidance = this.extension
      ? CONVERSION_GUIDANCE[this.extension]
      : undefined;

    if (guidance) {
      return `We can't read "${this.filename}" — that file format isn't supported for grading. Please save or export your work as ${guidance} and submit it again.`;
    }

    return `We couldn't read any text from "${this.filename}", so it can't be graded. Check that you uploaded the right file and that it isn't empty, password-protected, or corrupted, then submit it again.`;
  }
}
