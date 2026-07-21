export const MAX_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE =
  "Maximum number of attempts reached for this assignment.";
export const MAX_RETRIES_QUESTION_EXCEPTION_MESSAGE =
  "Maximum number of retries attempted for this question.";
export const SUBMISSION_DEADLINE_EXCEPTION_MESSAGE =
  "The attempt deadline has passed.";
export const GRADE_SUBMISSION_EXCEPTION =
  "Failed to submit the final grade to lms.";
export const IN_PROGRESS_SUBMISSION_EXCEPTION =
  "A attempt is already in progress and has not expired.";
export const TIME_RANGE_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE =
  "You have exceeded the allowed number of attempts within the specified time range.";
export const IN_COOLDOWN_PERIOD =
  "You must wait some time before creating a new attempt for this assignment";

/**
 * Stable, machine-readable codes carried in the 422 response body so the web
 * client can tell the attempt-creation rejections apart instead of collapsing
 * every 422 into "no more attempts". Keep these strings in sync with the web
 * client (apps/web/lib/learner.ts) — same contract as AI_TEMPORARILY_DISABLED.
 */
export const ATTEMPT_IN_PROGRESS_CODE = "ATTEMPT_IN_PROGRESS";
export const ATTEMPT_TIME_RANGE_EXCEEDED_CODE = "ATTEMPT_TIME_RANGE_EXCEEDED";
export const ATTEMPT_MAX_REACHED_CODE = "ATTEMPT_MAX_REACHED";
