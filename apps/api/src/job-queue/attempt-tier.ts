import { QuestionType } from "@prisma/client";
import { JOB_QUEUE_NAMES, JobQueueName } from "./job-queue.constants";

// Grading cost tier of an attempt, decided from question types alone.
// - inline: every question grades deterministically (no LLM) — grade at
//   submit, never enqueue.
// - heavy: at least one question triggers in-job file/image extraction, the
//   worker-memory hogs — route to mark.attempt.heavy and its dedicated pods.
// - standard: everything else (text/URL grading; LLM-bound but bounded
//   memory) — route to mark.attempt.
// This is the single seam to upgrade when extraction-at-upload lands: swap
// the input from question types to real extracted sizes, callers unchanged.
export type AttemptTier = "inline" | "standard" | "heavy";

const HEAVY_QUESTION_TYPES: ReadonlySet<QuestionType> = new Set([
  QuestionType.UPLOAD,
  QuestionType.LINK_FILE,
]);

const DETERMINISTIC_QUESTION_TYPES: ReadonlySet<QuestionType> = new Set([
  QuestionType.SINGLE_CORRECT,
  QuestionType.MULTIPLE_CORRECT,
  QuestionType.TRUE_FALSE,
]);

export function classifyAttemptTier(
  questionTypes: readonly QuestionType[],
): AttemptTier {
  // Unknown/empty question sets take the standard path — identical to
  // pre-tiering behavior, so a data gap can never make things worse.
  if (questionTypes.length === 0) {
    return "standard";
  }
  if (questionTypes.some((type) => HEAVY_QUESTION_TYPES.has(type))) {
    return "heavy";
  }
  if (questionTypes.every((type) => DETERMINISTIC_QUESTION_TYPES.has(type))) {
    return "inline";
  }
  return "standard";
}

export function attemptQueueForTier(
  tier: Exclude<AttemptTier, "inline">,
): JobQueueName {
  return tier === "heavy"
    ? JOB_QUEUE_NAMES.ATTEMPT_HEAVY
    : JOB_QUEUE_NAMES.ATTEMPT;
}
