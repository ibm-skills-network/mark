export const JOB_WORKER_HEARTBEAT_KEY_PREFIX = "mark.jobs.worker.heartbeat";

// Set of live heartbeat keys, maintained by the workers, so readers list
// them with one SMEMBERS instead of walking the whole keyspace with SCAN.
export const JOB_WORKER_HEARTBEAT_INDEX_KEY =
  "mark.jobs.worker.heartbeat.index";

export const DEFAULT_JOB_WORKER_CONNECT_RETRY_DELAY_MS = 5000;

// Once a worker has been seen, re-check this often; the fast retry above is
// only for noticing a worker come back.
export const DEFAULT_JOB_WORKER_CONNECTED_CHECK_INTERVAL_MS = 60_000;
