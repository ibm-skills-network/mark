import {
  ExtractedChunk,
  RubricCriterion,
} from "./types/criterion-evidence.types";

/**
 * Grading policy for submissions with no eligible learner evidence
 * (confirmed with product 2026-07-13).
 *
 * 1. No-evidence scoring: every criterion is awarded its MINIMUM rubric point
 *    level. This preserves the pre-refactor behavior on every path (pipeline
 *    quality gate, legacy fallback, FileGradingService minimum-response).
 *    Completion-only criteria (a single point level, min === max) award their
 *    points only when the submission is NON-EMPTY: submitting something counts
 *    as completion even when it is not valid evidence for substantive
 *    criteria. A completely empty submission (no learner-supplied content)
 *    is awarded zero on completion-only criteria so it can never reach 100%.
 *
 * 2. What counts as learner evidence:
 *    - Learner evidence: learner prose, code, tables, lists, equations,
 *      quotes, and image OCR / criterion-aware descriptions of learner uploads.
 *    - Never learner evidence: extraction metadata banners and key/value
 *      lines (metadata_only), generated summaries (generated_summary), system
 *      validator reports (non_learner_source — consumed separately by the
 *      deterministic validator overrides), page labels, exact prompt copies,
 *      exact rubric copies, and boilerplate repeated across pages.
 *
 * 3. Short answers can be valid: a block is rejected as too_short only below
 *    a noise floor (see GRADING_QUALITY.MIN_SUBSTANTIVE_TOKENS), and
 *    structural blocks (code/table/list/equation/quote/image) are always
 *    exempt, so valid short, visual, and structured submissions reach the
 *    rubric instead of being filtered by a generic prose-length rule.
 */
export const NO_EVIDENCE_RATIONALE =
  "No substantive learner evidence found in the submission.";

export const COMPLETION_ONLY_RATIONALE =
  "Submission completion recorded; no substantive criterion evidence was found.";

const SYSTEM_ARTIFACT_REASONS = new Set([
  "metadata_only",
  "generated_summary",
  "non_learner_source",
  "page_label",
]);

/**
 * Whether extraction found learner-supplied content rather than only
 * deterministic system artifacts. Low-quality learner content (for example,
 * a short answer or boilerplate) still counts as a non-empty submission.
 */
export function hasLearnerSuppliedContent(chunks: ExtractedChunk[]): boolean {
  return chunks.some((chunk) => {
    const reasons = chunk.quality?.ineligibleReasons ?? [];
    return (
      reasons.length === 0 ||
      reasons.some((reason) => !SYSTEM_ARTIFACT_REASONS.has(reason))
    );
  });
}

/**
 * Minimum point level defined by a criterion's rubric. Safe on empty level
 * lists (returns 0 instead of Math.min()'s Infinity).
 */
export function minimumRubricPoints(criterion: RubricCriterion): number {
  const points = criterion.criteria.map((level) => level.points);
  return points.length > 0 ? Math.min(...points) : 0;
}

/**
 * Points to award a criterion when a submission has no eligible evidence.
 * Multi-level criteria always get their minimum. Completion-only criteria
 * (min === max) get their points for a non-empty submission but zero for a
 * completely empty one, so an empty file can never earn full credit.
 */
export function noEvidencePoints(
  pointLevels: number[],
  submissionIsEmpty: boolean,
): number {
  const min = pointLevels.length > 0 ? Math.min(...pointLevels) : 0;
  if (!submissionIsEmpty) return min;
  const max = pointLevels.length > 0 ? Math.max(...pointLevels) : 0;
  return min === max ? 0 : min;
}

export function noEvidenceDecision(
  pointsAwarded: number,
  maxPoints: number,
): "meets" | "does_not_meet" {
  return maxPoints > 0 && pointsAwarded === maxPoints
    ? "meets"
    : "does_not_meet";
}

export function noEvidenceRationale(
  pointsAwarded: number,
  maxPoints: number,
): string {
  return noEvidenceDecision(pointsAwarded, maxPoints) === "meets"
    ? COMPLETION_ONLY_RATIONALE
    : NO_EVIDENCE_RATIONALE;
}
