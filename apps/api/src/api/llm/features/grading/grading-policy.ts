import { RubricCriterion } from "./types/criterion-evidence.types";

/**
 * Grading policy for submissions with no eligible learner evidence
 * (confirmed with product 2026-07-13).
 *
 * 1. No-evidence scoring: every criterion is awarded its MINIMUM rubric point
 *    level. This preserves the pre-refactor behavior on every path (pipeline
 *    quality gate, legacy fallback, FileGradingService minimum-response).
 *    Deliberate exception to the remediation plan's "never 100%" invariant:
 *    when a criterion has a single point level (min === max), the minimum IS
 *    full credit and is still awarded — completion-only criteria are meant to
 *    award their points unconditionally.
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

/**
 * Minimum point level defined by a criterion's rubric. Safe on empty level
 * lists (returns 0 instead of Math.min()'s Infinity).
 */
export function minimumRubricPoints(criterion: RubricCriterion): number {
  const points = criterion.criteria.map((level) => level.points);
  return points.length > 0 ? Math.min(...points) : 0;
}
