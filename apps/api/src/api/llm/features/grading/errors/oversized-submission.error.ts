/**
 * Thrown when a learner submission would expand into more evidence blocks
 * than the per-submission cap allows. Used to short-circuit grading before
 * the in-process block array is allocated, and to signal the job worker that
 * the failure is not retryable (the same input will always overflow).
 *
 * The fields are exposed as own enumerable properties so the project logger
 * can serialize them as structured context without leaking the message.
 */
import { LearnerFacingGradingError } from "./learner-facing-grading.error";

export interface OversizedSubmissionErrorFields {
  blockCount: number;
  cap: number;
  filename?: string;
  questionId?: number;
  attemptId?: number;
}

export class OversizedSubmissionError extends LearnerFacingGradingError {
  public readonly blockCount: number;
  public readonly cap: number;
  public readonly filename?: string;
  public readonly questionId?: number;
  public readonly attemptId?: number;

  constructor(fields: OversizedSubmissionErrorFields) {
    super(
      `Submission would produce ${fields.blockCount} blocks, exceeding the per-submission cap of ${fields.cap}.`,
    );
    this.name = "OversizedSubmissionError";
    this.blockCount = fields.blockCount;
    this.cap = fields.cap;
    this.filename = fields.filename;
    this.questionId = fields.questionId;
    this.attemptId = fields.attemptId;

    // Restore the prototype chain when extending built-in Error so that
    // `instanceof` works correctly under the project's TypeScript target.
    Object.setPrototypeOf(this, OversizedSubmissionError.prototype);
  }

  /**
   * Message safe to show a learner in the grading modal/toast. Deliberately
   * omits block counts and caps — those are operator details that live in
   * `message` and the structured logs.
   */
  get learnerMessage(): string {
    const subject = this.filename
      ? `"${this.filename}" is`
      : "Your submission is";
    return `${subject} too large for automatic grading. Try reducing its length (fewer pages, rows, or sheets) and submit it again.`;
  }
}
