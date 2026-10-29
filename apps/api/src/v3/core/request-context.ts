import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

/** The ids every v3 log line and Instana span carries. */
export type V3RequestContext = {
  request_id: string;
  trace_id: string | null;
  user_id: string | null;
  role: string | null;
  assignment_id: number | null;
};

/** Per-request state: the logged context plus what the outcome line needs. */
export type V3RequestState = {
  readonly context: V3RequestContext;
  /** `METHOD /template` of the public path, e.g. `GET /api/v1/user-session`. */
  readonly route: string;
  readonly startedAt: number;
};

const storage = new AsyncLocalStorage<V3RequestState>();

export function newRequestState(
  requestId: string,
  traceId: string | null,
  route: string,
): V3RequestState {
  return {
    context: {
      request_id: requestId,
      trace_id: traceId,
      user_id: null,
      role: null,
      assignment_id: null,
    },
    route,
    startedAt: performance.now(),
  };
}

/** Runs `work` with `state` as the current request for everything it awaits. */
export function runInRequest<T>(state: V3RequestState, work: () => T): T {
  return storage.run(state, work);
}

export function currentRequestContext(): V3RequestContext | undefined {
  return storage.getStore()?.context;
}

export function elapsedMs(state: V3RequestState): number {
  return Math.round(performance.now() - state.startedAt);
}
