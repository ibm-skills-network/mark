/**
 * The structured failure the grading worker attaches to a "Failed" status.
 *
 * Two kinds:
 * - `unable_to_grade`: the submission can't be graded as submitted (dead or
 *   private link, wrong file, empty file, ...). The learner can fix it, so it
 *   is shown as a warning with a fix per question and is never reported.
 * - `grading_failed`: our fault or unexpected. The existing red failure.
 *
 * Older servers send no `failure`; the caller then keeps the red path.
 */

export const GRADING_ISSUE_CODES = [
  "url_unreachable",
  "url_placeholder",
  "url_template_repo",
  "url_invalid",
  "url_blocked",
  "url_empty",
  "url_unsupported",
  "url_temporarily_unavailable",
  "file_wrong_format",
  "file_corrupt",
  "file_encrypted",
  "file_empty",
  "file_no_text",
  "file_unsupported_type",
  "file_too_large",
  "source_unreadable",
] as const;

export type GradingIssueCode = (typeof GRADING_ISSUE_CODES)[number];

export interface GradingIssueSource {
  kind: "url" | "file";
  url?: string;
  fileName?: string;
  httpStatus?: number;
  detectedType?: string;
  expectedType?: string;
}

export interface GradingIssue {
  questionId: number;
  /**
   * Usually a GradingIssueCode, but kept as any string: a newer server may
   * send a code this client doesn't know, and its `message` is still shown.
   */
  code: string;
  source?: GradingIssueSource;
  retryable: boolean;
  message: string;
}

export interface GradingFailure {
  kind: "unable_to_grade" | "grading_failed";
  issues: GradingIssue[];
}

// Bounds mirror the contract; anything longer is cut rather than rejected so
// one oversized field cannot hide the rest of the issue from the learner.
const MAX_URL_LENGTH = 300;
const MAX_FILE_NAME_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_CODE_LENGTH = 64;
const MAX_TYPE_LENGTH = 20;
const MAX_ISSUES = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** File-type labels are interpolated into copy, so keep them to a bare token. */
function fileTypeLabel(value: unknown): string | undefined {
  const raw = boundedString(value, MAX_TYPE_LENGTH * 2);
  if (!raw) return undefined;
  const cleaned = raw
    .toLowerCase()
    .replace(/^\.+/, "")
    .replace(/[^a-z0-9+-]/g, "")
    .slice(0, MAX_TYPE_LENGTH);
  return cleaned || undefined;
}

function parseSource(value: unknown): GradingIssueSource | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind !== "url" && value.kind !== "file") return undefined;

  const source: GradingIssueSource = { kind: value.kind };
  const url = boundedString(value.url, MAX_URL_LENGTH);
  if (url) source.url = url;
  const fileName = boundedString(value.fileName, MAX_FILE_NAME_LENGTH);
  if (fileName) source.fileName = fileName;
  if (
    typeof value.httpStatus === "number" &&
    Number.isInteger(value.httpStatus) &&
    value.httpStatus >= 100 &&
    value.httpStatus <= 599
  ) {
    source.httpStatus = value.httpStatus;
  }
  const detectedType = fileTypeLabel(value.detectedType);
  if (detectedType) source.detectedType = detectedType;
  const expectedType = fileTypeLabel(value.expectedType);
  if (expectedType) source.expectedType = expectedType;
  return source;
}

function parseIssue(value: unknown): GradingIssue | undefined {
  if (!isRecord(value)) return undefined;
  const { questionId } = value;
  if (
    typeof questionId !== "number" ||
    !Number.isSafeInteger(questionId) ||
    questionId <= 0
  ) {
    return undefined;
  }
  const code = boundedString(value.code, MAX_CODE_LENGTH);
  if (!code) return undefined;

  const issue: GradingIssue = {
    questionId,
    code,
    retryable: value.retryable === true,
    message: boundedString(value.message, MAX_MESSAGE_LENGTH) ?? "",
  };
  const source = parseSource(value.source);
  if (source) issue.source = source;
  return issue;
}

/**
 * Validates a `failure` payload from the status stream. Returns undefined for
 * anything that is not a usable failure, so a malformed payload falls back to
 * the existing red failure path rather than to an empty warning.
 */
export function parseGradingFailure(
  value: unknown,
): GradingFailure | undefined {
  if (!isRecord(value)) return undefined;
  const { kind } = value;
  if (kind !== "unable_to_grade" && kind !== "grading_failed") return undefined;

  const rawIssues = Array.isArray(value.issues)
    ? value.issues.slice(0, MAX_ISSUES)
    : [];
  const issues = rawIssues
    .map(parseIssue)
    .filter((issue): issue is GradingIssue => issue !== undefined);

  // Telling a learner to fix something without saying what is worse than the
  // generic failure, which at least lets them report it.
  if (kind === "unable_to_grade" && issues.length === 0) return undefined;

  return { kind, issues };
}

export function isLearnerFixableFailure(
  failure: GradingFailure | undefined,
): failure is GradingFailure & { kind: "unable_to_grade" } {
  return failure?.kind === "unable_to_grade" && failure.issues.length > 0;
}

/**
 * Thrown when grading stopped because the submission itself needs fixing.
 * Callers keep the learner's answers and show the fix list; this is not an
 * error to toast or report.
 */
export class GradingUnableError extends Error {
  constructor(
    message: string,
    readonly failure: GradingFailure,
  ) {
    super(message);
    this.name = "GradingUnableError";
  }
}

/** Duck-typed: `instanceof` is unreliable across Next's module boundary. */
export function isGradingUnableError(
  error: unknown,
): error is GradingUnableError {
  return (
    error instanceof Error &&
    error.name === "GradingUnableError" &&
    isRecord((error as { failure?: unknown }).failure)
  );
}
