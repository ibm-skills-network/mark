/**
 * Two-stage publish-job SSE payload contract — frontend mirror.
 *
 * Source of truth: apps/api/src/api/assignment/v2/services/publish-job-result.types.ts
 *
 * Keep the two files structurally aligned so future drift is grep-detectable.
 * The frontend mirrors the contract so SSE consumers can type-guard
 * JobStatusUpdate.result at the network boundary without importing API code.
 */
export type PublishStage =
  | "db_writes_done"
  | "translations_in_progress"
  | "translations_complete";

export interface PerJobTranslationEntry {
  kind: "question" | "variant" | "meta";
  id: number;
  status: "pending" | "in_progress" | "completed" | "failed";
  languagesCompleted: number;
  languagesTotal: number;
}

export interface PublishJobResult {
  stage: PublishStage;
  translations?: {
    aggregate: {
      completed: number;
      total: number;
      failed: number;
    };
    perJob: PerJobTranslationEntry[];
  };
  /**
   * Set when translations were needed but deliberately skipped (not failed).
   * "ai_unavailable" = the AI kill-switch was on, so the publish succeeded
   * without translations and the author should be told (not shown a failure).
   */
  translationsSkippedReason?: "ai_unavailable";
}
