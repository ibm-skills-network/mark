import { JOB_QUEUE_NAMES } from "./job-queue.constants";

// Operational role of each queue, shown as a badge on the admin dashboard.
// Roles are a property of what the queue is FOR and do not drift at runtime,
// so they live in static metadata rather than coming off a heartbeat.
export type QueueRole =
  | "author"
  | "learner"
  | "translation"
  | "admin-maintenance";

export interface QueueMetadata {
  // Static operational role for the badge.
  role: QueueRole;
  // Fallback per-pod concurrency used only when a worker heartbeat does not
  // publish concurrencyByQueue (older pods). When the heartbeat carries the
  // real value, that wins — this is just a floor so the capacity line is never
  // blank for a known queue.
  defaultConcurrencyPerPod: number;
}

// Keyed by the queue's wire name (the value in JOB_QUEUE_NAMES). Concurrency
// defaults mirror the worker registration: v1/v2 author generation = 2 each,
// grading (attempt) = 4, translations = 8, admin maintenance = 1.
export const QUEUE_METADATA: Record<string, QueueMetadata> = {
  [JOB_QUEUE_NAMES.ASSIGNMENT_V1]: {
    role: "author",
    defaultConcurrencyPerPod: 2,
  },
  [JOB_QUEUE_NAMES.ASSIGNMENT_V2]: {
    role: "author",
    defaultConcurrencyPerPod: 2,
  },
  [JOB_QUEUE_NAMES.ATTEMPT]: {
    role: "learner",
    defaultConcurrencyPerPod: 4,
  },
  [JOB_QUEUE_NAMES.ASSIGNMENT_V2_TRANSLATIONS]: {
    role: "translation",
    defaultConcurrencyPerPod: 8,
  },
  [JOB_QUEUE_NAMES.ADMIN_TRANSLATION]: {
    role: "admin-maintenance",
    defaultConcurrencyPerPod: 1,
  },
};
