import {
  buildGradingIssue,
  GradingIssue,
  GradingIssueCode,
  GradingIssueDetails,
  GradingIssueSource,
  summarizeGradingFailure,
} from "./grading-failure";
import { LearnerFacingGradingError } from "./learner-facing-grading.error";

export type SourceProcessingReason =
  | "extraction_failed"
  | "insufficient_source_evidence"
  | "url_fetch_failed";

const GENERIC_MESSAGE =
  "Required source material could not be processed. Check or replace the submitted file or link and try again. No new grade was saved.";

const DEFAULT_CODE: Record<SourceProcessingReason, GradingIssueCode> = {
  extraction_failed: "source_unreadable",
  insufficient_source_evidence: "source_unreadable",
  url_fetch_failed: "url_unreachable",
};

/**
 * No score exists for this run. `sourceReference` is positional ("file:1",
 * "url"); learner-supplied URL/file names travel only in `source`, which is
 * sanitized before it reaches a payload.
 *
 * A strategy throws one of these per blocked question. The wave runner then
 * collects every blocked question in the attempt into a single error whose
 * `issues` lists them all.
 */
export class SourceProcessingError extends LearnerFacingGradingError {
  readonly retryable = false;
  readonly code: GradingIssueCode;
  readonly source?: GradingIssueSource;
  readonly issueMessage?: string;
  readonly questionId?: number;
  /** Every blocked question in the attempt; empty until one is attached. */
  readonly issues: GradingIssue[];

  constructor(
    readonly reason: SourceProcessingReason,
    readonly sourceReference: string,
    details?: Partial<GradingIssueDetails> & {
      questionId?: number;
      issues?: GradingIssue[];
    },
  ) {
    const issues = details?.issues ?? [];
    let message = GENERIC_MESSAGE;
    if (issues.length > 0) {
      message = summarizeGradingFailure({ kind: "unable_to_grade", issues });
    } else if (details?.code) {
      message = `${
        buildGradingIssue(details.questionId ?? 0, {
          code: details.code,
          source: details.source,
          message: details.message,
        }).message
      } No new grade was saved.`;
    }
    super(message);
    this.name = "SourceProcessingError";
    this.code = details?.code ?? DEFAULT_CODE[reason];
    this.source = details?.source;
    this.issueMessage = details?.message;
    this.questionId = details?.questionId;
    this.issues = issues;
  }

  get learnerMessage(): string {
    return this.message;
  }

  /** The payload issue for this single block, attributed to a question. */
  toIssue(questionId: number): GradingIssue {
    return buildGradingIssue(this.questionId ?? questionId, {
      code: this.code,
      source: this.source,
      message: this.issueMessage,
    });
  }

  /** One error describing every blocked question in an attempt. */
  static aggregate(issues: GradingIssue[]): SourceProcessingError {
    const reason: SourceProcessingReason = issues[0]?.code.startsWith("url_")
      ? "url_fetch_failed"
      : "extraction_failed";
    return new SourceProcessingError(reason, "attempt", {
      code: issues[0]?.code,
      issues,
    });
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
