import { LearnerFacingGradingError } from "./learner-facing-grading.error";

export type SourceProcessingReason =
  | "extraction_failed"
  | "insufficient_source_evidence"
  | "url_fetch_failed";

/** No score exists for this run. Source references deliberately contain no URLs/content. */
export class SourceProcessingError extends LearnerFacingGradingError {
  readonly retryable = false;
  constructor(
    readonly reason: SourceProcessingReason,
    readonly sourceReference: string,
  ) {
    super(
      "Required source material could not be processed. Check or replace the submitted file or link and try again. No new grade was saved.",
    );
    this.name = "SourceProcessingError";
  }

  get learnerMessage(): string {
    return this.message;
  }
}

/** A dependency outage follows the existing bounded queue retry policy. */
export class RetryableProcessingError extends Error {
  readonly retryable = true;
  constructor(
    readonly reason:
      | "moderation_unavailable"
      | "grading_unavailable"
      | "source_unavailable",
    readonly sourceReference?: string,
  ) {
    super(
      "The grading service is temporarily unavailable. Please try again shortly. No new grade was saved.",
    );
    this.name = "RetryableProcessingError";
  }
}
