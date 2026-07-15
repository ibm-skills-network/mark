export const JOB_QUEUE_NAMES = {
  ASSIGNMENT_V1: "mark.assignment.v1",
  ASSIGNMENT_V2: "mark.assignment.v2",
  ATTEMPT: "mark.attempt",
  // Grading for attempts that contain file/image questions. Isolated so the
  // in-job extraction memory spikes land on the dedicated heavy worker
  // deployment and can never OOM the pods draining the fast queues.
  ATTEMPT_HEAVY: "mark.attempt.heavy",
  ADMIN_TRANSLATION: "mark.admin.translation",
  ASSIGNMENT_V2_TRANSLATIONS: "mark.assignment.v2.translations",
} as const;

export const JOB_NAMES = {
  ASSIGNMENT_V1_GENERATE_QUESTIONS: "assignment-v1.generate-questions",
  ASSIGNMENT_V2_GENERATE_QUESTIONS: "assignment-v2.generate-questions",
  ASSIGNMENT_V2_PUBLISH: "assignment-v2.publish",
  ASSIGNMENT_V2_RETRY_FAILED_TRANSLATIONS:
    "assignment-v2.retry-failed-translations",
  ATTEMPT_GRADE: "attempt.grade",
  ATTEMPT_AUTHOR_PREVIEW: "attempt.author-preview",
  ADMIN_FIX_MISSING_TRANSLATIONS: "admin.fix-missing-translations",
  ADMIN_SWEEP_MISSING_TRANSLATIONS: "admin.sweep-missing-translations",
  TRANSLATE_QUESTION: "assignment-v2.translate-question",
  TRANSLATE_VARIANT: "assignment-v2.translate-variant",
  TRANSLATE_META: "assignment-v2.translate-meta",
} as const;

// BullMQ processes jobs enqueued WITHOUT a priority before ALL prioritized
// jobs (they live in the plain waiting list, which workers check first). So
// on any queue where ordering matters, every job must carry an explicit
// priority — a single unprioritized enqueue site would jump the whole line.
// JobQueueService.enqueue() applies this map automatically by job name so no
// call site can forget. 1 = highest; the 1→10 gap leaves room for a future
// retry-deprioritization class without renumbering. Job names absent from
// this map stay unprioritized (fine for single-class queues like publish and
// admin maintenance).
export const JOB_PRIORITIES: Partial<Record<JobName, number>> = {
  [JOB_NAMES.ATTEMPT_GRADE]: 1,
  [JOB_NAMES.ATTEMPT_AUTHOR_PREVIEW]: 10,
  [JOB_NAMES.TRANSLATE_QUESTION]: 1,
  [JOB_NAMES.TRANSLATE_VARIANT]: 1,
  [JOB_NAMES.TRANSLATE_META]: 1,
  [JOB_NAMES.ASSIGNMENT_V2_RETRY_FAILED_TRANSLATIONS]: 10,
};

export type JobQueueName =
  (typeof JOB_QUEUE_NAMES)[keyof typeof JOB_QUEUE_NAMES];

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];
