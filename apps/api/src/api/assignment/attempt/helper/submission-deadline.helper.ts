import { ConflictException } from "@nestjs/common";

/**
 * How long after `expiresAt` a submit still counts as on time.
 *
 * The learner UI auto-submits on the first countdown tick past the deadline
 * plus a short delay, and the request then crosses the learner's network, the
 * Next proxy and our ingress before the API sees it. Ten seconds was not
 * enough for that path and zeroed attempts whose auto-submit landed seconds
 * late. Every deadline check, v1 and v2, reads this one value.
 */
export const ATTEMPT_SUBMISSION_GRACE_MS = 30_000;

const toMs = (value: Date | string | number): number =>
  value instanceof Date ? value.getTime() : new Date(value).getTime();

/**
 * True when a submit received at `receivedAt` is past the attempt's deadline
 * plus the grace window. An attempt with no deadline never expires.
 */
export const isPastSubmissionGrace = (
  expiresAt: Date | string | null | undefined,
  receivedAt: Date = new Date(),
): boolean => {
  if (!expiresAt) return false;
  const expiresAtMs = toMs(expiresAt);
  if (Number.isNaN(expiresAtMs)) return false;
  return receivedAt.getTime() - ATTEMPT_SUBMISSION_GRACE_MS > expiresAtMs;
};

/**
 * How close to the deadline a submit leaves no time to fix a dead link or an
 * unreadable file and submit again. Grading such a submit scores those
 * questions 0 rather than handing the attempt back, which would only be
 * closed at zero once the grace window passed.
 */
export const FINAL_SUBMIT_WINDOW_MS = 60_000;

/** True when a submit received at `receivedAt` is within that window of the deadline, or past it. */
export const isFinalSubmitBeforeDeadline = (
  expiresAt: Date | string | null | undefined,
  receivedAt: Date = new Date(),
): boolean => {
  if (!expiresAt) return false;
  const expiresAtMs = toMs(expiresAt);
  if (Number.isNaN(expiresAtMs)) return false;
  return receivedAt.getTime() >= expiresAtMs - FINAL_SUBMIT_WINDOW_MS;
};

/** What the v2 expiry handler writes on an attempt it closes at zero. */
export const EXPIRED_ATTEMPT_COMMENT =
  "You submitted the assignment after the deadline. Your submission will not be graded. If you don't have any more attempts, please contact your instructor.";

/** Prefix of what the v1 expiry path writes on an attempt it auto-submits. */
const V1_TIME_LIMIT_COMMENT_PREFIX =
  "Your assignment was automatically submitted because the time limit was reached.";

/** Whether a submitted attempt was closed by a deadline check, not the learner. */
export const wasClosedAtTimeLimit = (
  comments: string | null | undefined,
): boolean =>
  typeof comments === "string" &&
  (comments === EXPIRED_ATTEMPT_COMMENT ||
    comments.startsWith(V1_TIME_LIMIT_COMMENT_PREFIX));

export const ATTEMPT_CLOSED_AT_TIME_LIMIT_CODE = "ATTEMPT_CLOSED_AT_TIME_LIMIT";
export const ATTEMPT_ALREADY_SUBMITTED_CODE = "ATTEMPT_ALREADY_SUBMITTED";

export const ATTEMPT_CLOSED_AT_TIME_LIMIT_MESSAGE =
  "This attempt was already closed at its time limit.";
export const ATTEMPT_ALREADY_SUBMITTED_MESSAGE =
  "This attempt has already been submitted.";

export type AttemptClosedReason = "time_limit" | "already_submitted";

/**
 * 409 for a submit on an attempt that is no longer open. The body carries a
 * machine-readable `code` so the learner UI can say which of the two happened
 * in the learner's language, and `learnerMessage` is the same honest copy for
 * paths (the grading job status) that can only carry text.
 */
export class AttemptClosedException extends ConflictException {
  readonly learnerMessage: string;

  constructor(
    readonly attemptId: number,
    readonly reason: AttemptClosedReason,
  ) {
    const timeLimit = reason === "time_limit";
    const message = timeLimit
      ? ATTEMPT_CLOSED_AT_TIME_LIMIT_MESSAGE
      : ATTEMPT_ALREADY_SUBMITTED_MESSAGE;
    super({
      statusCode: 409,
      error: "Conflict",
      code: timeLimit
        ? ATTEMPT_CLOSED_AT_TIME_LIMIT_CODE
        : ATTEMPT_ALREADY_SUBMITTED_CODE,
      message,
      attemptId,
    });
    this.learnerMessage = message;
    // Kept as the base name: the job worker and log tooling classify a
    // duplicate submit by it once the error has crossed a process boundary.
    this.name = "ConflictException";
  }
}
