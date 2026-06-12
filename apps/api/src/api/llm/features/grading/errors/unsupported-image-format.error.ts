import { LearnerFacingGradingError } from "./learner-facing-grading.error";

/**
 * Thrown when a learner image is in a format the vision model cannot grade
 * and cannot be converted to one it accepts (HEIC, SVG, or unrecognizable
 * data). Signals the job worker that the failure is terminal — the same
 * input will always be rejected — and carries a learner-facing message that
 * tells the submitter how to fix it.
 *
 * The fields are exposed as own enumerable properties so the project logger
 * can serialize them as structured context without leaking the message.
 */
export interface UnsupportedImageFormatErrorFields {
  filename?: string;
  detectedFormat?: string;
  reason: string;
}

export class UnsupportedImageFormatError extends LearnerFacingGradingError {
  public readonly filename?: string;
  public readonly detectedFormat?: string;
  public readonly reason: string;

  constructor(fields: UnsupportedImageFormatErrorFields) {
    super(
      `Unsupported image format${
        fields.detectedFormat ? ` (${fields.detectedFormat})` : ""
      }: ${fields.reason}`,
    );
    this.name = "UnsupportedImageFormatError";
    this.filename = fields.filename;
    this.detectedFormat = fields.detectedFormat;
    this.reason = fields.reason;

    // Restore the prototype chain when extending built-in Error so that
    // `instanceof` works correctly under the project's TypeScript target.
    Object.setPrototypeOf(this, UnsupportedImageFormatError.prototype);
  }

  /**
   * Message safe to show a learner in the grading modal/toast. Deliberately
   * omits the detected format and technical reason — those are operator
   * details that live in `message` and the structured logs.
   */
  get learnerMessage(): string {
    return this.filename
      ? `"${this.filename}" is not a supported image format. Please upload a PNG, JPEG, GIF, or WebP image.`
      : "Your image is not in a supported format. Please upload a PNG, JPEG, GIF, or WebP image.";
  }
}
