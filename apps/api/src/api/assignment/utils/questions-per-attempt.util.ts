/**
 * The random-subset size an assignment can actually serve.
 *
 * A count larger than the question pool cannot be honoured: attempt creation
 * serves the whole pool instead (see
 * AttemptSubmissionService.createAssignmentAttempt), which is already exactly
 * what 0/null mean. Authors reach that state by deleting questions after
 * setting the count, so rejecting the publish would strand them with a config
 * they cannot publish and cannot see is wrong. Fold the count down to the pool
 * and let the publish through.
 *
 * Counts that already fit come back untouched, including the 0/null that mean
 * "serve everything" — rewriting those would churn stored config for no
 * behavioural gain. An empty pool collapses to null, since there is no
 * positive count that describes "no questions to draw from".
 */
export const clampQuestionsPerAttempt = (
  requested: number | null | undefined,
  poolSize: number,
): number | null | undefined => {
  if (requested === null || requested === undefined || requested <= 0) {
    return requested;
  }
  if (requested <= poolSize) {
    return requested;
  }
  return poolSize > 0 ? poolSize : null;
};
