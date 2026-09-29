const DEFAULT_GRADING_CACHE_REVISION = "2026-09-22-complete-text-and-rubric";

/**
 * Return the model identity used by persistent grading caches.
 *
 * Some providers expose rolling model slugs, so the slug alone is not a
 * stable description of the backend that produced a grade. Deployments can
 * bump GRADING_CACHE_REVISION whenever model or grader semantics change,
 * invalidating old entries without deleting the shared cache table.
 */
export function getGradingModelCacheIdentity(modelKey: string): string {
  const configuredRevision = process.env.GRADING_CACHE_REVISION?.trim();
  // A deployment override must never mask an application semantics change.
  const revision =
    configuredRevision && configuredRevision !== DEFAULT_GRADING_CACHE_REVISION
      ? `${DEFAULT_GRADING_CACHE_REVISION}:${configuredRevision}`
      : DEFAULT_GRADING_CACHE_REVISION;
  return `${modelKey}@${revision}`;
}
