export const JOB_QUEUE_NAMES = {
  ASSIGNMENT_V1: "mark.assignment.v1",
  ASSIGNMENT_V2: "mark.assignment.v2",
  ATTEMPT: "mark.attempt",
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

export type JobQueueName =
  (typeof JOB_QUEUE_NAMES)[keyof typeof JOB_QUEUE_NAMES];

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];
