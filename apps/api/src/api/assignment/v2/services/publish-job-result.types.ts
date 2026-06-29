/**
 * Two-stage publish-job SSE payload contract.
 *
 * Producer side: assignment.service.ts runPublishJob populates this and rides
 * it on the existing JobStatusUpdate.result?: unknown field — no schema
 * change to JobStatusUpdate. Backwards-compatible for non-publish jobs that
 * ignore the field.
 *
 * Consumer side: SSE clients type-guard at the message boundary:
 *   const r = job.result as PublishJobResult | undefined;
 *   if (r?.stage === "db_writes_done") { ... }
 */
export type PublishStage =
  | "db_writes_done"
  | "translations_in_progress"
  | "translations_complete";

/**
 * Per-job entry in the translations aggregate. One entry per spawned
 * translation BullMQ job (question / variant / meta). Round-trips losslessly
 * through Redis HSET serialization.
 */
export interface PerJobTranslationEntry {
  kind: "question" | "variant" | "meta";
  id: number;
  status: "pending" | "in_progress" | "completed" | "failed";
  languagesCompleted: number;
  languagesTotal: number;
}

/**
 * The PublishJobResult sits inside JobStatusUpdate.result. Its presence
 * signals that the publish job is in a translation phase (vs. earlier DB
 * writes). The translations field is undefined immediately after the
 * db_writes_done stage transition, then populated on every subsequent
 * poll tick once the worker HSET fires.
 */
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
   * "ai_unavailable" = the AI kill-switch (AUTHORING) was on, so the publish
   * succeeded without translations. The client shows an informational notice
   * rather than a failure, and the author can re-publish once AI is restored.
   */
  translationsSkippedReason?: "ai_unavailable";
}
