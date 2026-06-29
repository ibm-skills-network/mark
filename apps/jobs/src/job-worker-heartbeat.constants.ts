export const JOB_WORKER_HEARTBEAT_KEY_PREFIX = "mark.jobs.worker.heartbeat";

export const DEFAULT_JOB_WORKER_HEARTBEAT_INTERVAL_MS = 10_000;
export const DEFAULT_JOB_WORKER_HEARTBEAT_TTL_SECONDS = 30;

// Local file the worker rewrites on every heartbeat tick. The jobs app is a
// context-only worker with no HTTP server, so the Kubernetes livenessProbe is
// an exec check on this file's age. It is written independently of the Redis
// heartbeat so a transient Redis outage never makes a healthy worker look dead
// and trigger a restart. This path MUST match the livenessProbe command in
// helm-chart/mark-jobs/templates/deployment.yaml; override with the
// JOB_WORKER_LIVENESS_FILE env var (update the probe to match if you do).
export const DEFAULT_JOB_WORKER_LIVENESS_FILE =
  "/tmp/mark-jobs-worker.heartbeat";
