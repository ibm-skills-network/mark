import {
  buildGradingIssue,
  GradingFailure,
  GradingIssue,
  gradingFailedFailure,
  isGradingFailure,
} from "./grading-failure";
import { OversizedSubmissionError } from "./oversized-submission.error";
import { RetryableUrlFetchError } from "./retryable-url-fetch.error";
import { SourceProcessingError } from "./source-processing.error";
import { UnsupportedImageFormatError } from "./unsupported-image-format.error";

/**
 * The learner-fixable issue a single question's grading error stands for, or
 * undefined when the error is ours (a bug, a provider outage, a 5xx).
 */
export function issueFromQuestionError(
  error: unknown,
  questionId: number,
): GradingIssue | undefined {
  if (error instanceof SourceProcessingError) {
    return error.toIssue(questionId);
  }
  if (error instanceof UnsupportedImageFormatError) {
    return buildGradingIssue(questionId, {
      code: "file_unsupported_type",
      source: {
        kind: "file",
        fileName: error.filename,
        detectedType: error.detectedFormat?.replace(/^image\//, ""),
      },
    });
  }
  if (error instanceof OversizedSubmissionError) {
    return buildGradingIssue(error.questionId ?? questionId, {
      code: "file_too_large",
      source: { kind: "file", fileName: error.filename },
    });
  }
  if (error instanceof RetryableUrlFetchError) {
    return buildGradingIssue(error.questionId ?? questionId, {
      code: "url_temporarily_unavailable",
      source: {
        kind: "url",
        url: error.learnerUrl,
        httpStatus: error.status,
      },
    });
  }
  return undefined;
}

/**
 * The failure payload for a terminal grading error. Anything not recognised
 * as learner-fixable is `grading_failed`.
 */
export function gradingFailureFromError(error: unknown): GradingFailure {
  const carried = (error as { gradingFailure?: unknown } | undefined)
    ?.gradingFailure;
  if (isGradingFailure(carried)) return carried;

  if (error instanceof SourceProcessingError) {
    const issues =
      error.issues.length > 0
        ? error.issues
        : [error.toIssue(error.questionId ?? 0)];
    return { kind: "unable_to_grade", issues };
  }
  const issue = issueFromQuestionError(error, 0);
  if (issue) return { kind: "unable_to_grade", issues: [issue] };
  return gradingFailedFailure();
}
