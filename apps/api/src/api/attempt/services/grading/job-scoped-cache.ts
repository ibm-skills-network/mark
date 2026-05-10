import type { Question, Translation } from "@prisma/client";

/**
 * Per-job read-side cache for the grading hot path.
 *
 * Lifetime: one invocation of processGradingJob / processAuthorPreviewJob.
 * Lives on the call stack; dies when the function returns. Never share between jobs.
 *
 * Use `cache.translations.has(key)` (NOT `.get(key) !== undefined`) to distinguish
 * "checked, was null" from "not yet checked" — same convention applies to questions.
 *
 * `questions` holds the FULL `Question` Prisma row so that the deepest read site
 * (`QuestionService.findOne`) can build its `QuestionDto` from a cached row without
 * re-issuing `prisma.question.findUnique`. The narrower `getAssignmentContext`
 * caller (which only reads `gradingContextQuestionIds`) is satisfied by the same
 * wide row.
 */
export interface JobScopedCache {
  assignment?: { instructions: string | null };
  questions: Map<number, Question>;
  translations: Map<string, Translation | null>;
}

/**
 * Build the translations Map key from (language, questionId, variantId).
 * variantId may be null when no variant is in play; encode as the literal string "null"
 * so the key is a stable string and "null"-variant entries do not collide with id=0.
 */
export const buildTranslationCacheKey = (
  language: string,
  questionId: number,
  variantId: number | null,
): string => `${language}:${questionId}:${variantId ?? "null"}`;

export const newJobScopedCache = (): JobScopedCache => ({
  questions: new Map(),
  translations: new Map(),
});
