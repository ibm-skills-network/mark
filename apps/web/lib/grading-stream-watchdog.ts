/**
 * Timeouts for the learner's grading status stream.
 *
 * The server sends a named `heartbeat` frame every 10 seconds for as long as
 * the stream is open, and it does so from the process serving the stream —
 * not from the grading worker. That means two different things can go wrong,
 * and they need two different clocks:
 *
 *  1. The stream itself dies (proxy drop, pod restart, network loss) and
 *     nothing arrives at all. A healthy connection is never silent for longer
 *     than a few heartbeats, so this clock can be short.
 *  2. The stream is healthy but grading stops advancing. Heartbeats keep
 *     re-arming clock 1, so without a second clock that ignores them the
 *     learner watches the spinner forever.
 *
 * Only non-heartbeat frames count as evidence that grading is alive: the
 * server publishes to the job channel exclusively when job state changes.
 */

/** Server heartbeat cadence. Mirrored here only to justify the idle budget. */
const SERVER_HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * No bytes of any kind for this long means the connection is dead. Four and a
 * half missed heartbeats — enough to absorb GC pauses, background-tab
 * throttling and proxy jitter, far short of anything grading-related.
 */
export const SSE_IDLE_TIMEOUT_MS = SERVER_HEARTBEAT_INTERVAL_MS * 4.5;

/** Connection attempts before the stream is declared lost. */
export const SSE_MAX_CONNECTION_ATTEMPTS = 3;

/** Linear backoff step between reconnect attempts. */
export const SSE_RECONNECT_BACKOFF_STEP_MS = 2000;

/**
 * Connection alive, but no grading progress for this long. Non-destructive:
 * the stream stays open and the learner is told the truth rather than being
 * cut off. Comfortably above the largest normal gap between two progress
 * frames (one question chaining its LLM calls), so it does not cry wolf on
 * ordinary slow file grading.
 */
export const GRADING_STALL_WARNING_MS = 180_000;

/**
 * Hard stop. Sits above the server's own dead-worker detection window (the
 * attempt lock duration plus one stall-check tick), so a worker that died
 * mid-grade has already been failed and reported through the stream before
 * this fires. Reached only while heartbeats prove the pipe is alive, so it
 * can never kill a grade that is genuinely progressing.
 */
export const GRADING_STALL_TIMEOUT_MS = 900_000;

export interface GradingWatchdogHandlers {
  /** No bytes at all for the idle window — this connection is dead. */
  onIdleTimeout: () => void;
  /** Connection alive, grading has not advanced for the warning window. */
  onStallWarning: () => void;
  /** Connection alive, grading has not advanced for the timeout window. */
  onStallTimeout: () => void;
}

export interface GradingWatchdogOptions {
  idleTimeoutMs?: number;
  stallWarningMs?: number;
  stallTimeoutMs?: number;
}

/**
 * Owns the three clocks behind the grading spinner. Connection-level state
 * (the idle clock) is reset by reconnects; grading-level state (the two stall
 * clocks) deliberately is not, so a flapping connection cannot mask a grade
 * that stopped moving.
 */
export class GradingWatchdog {
  private idleTimer?: ReturnType<typeof setTimeout>;
  private stallWarningTimer?: ReturnType<typeof setTimeout>;
  private stallTimer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private warned = false;

  private readonly idleTimeoutMs: number;
  private readonly stallWarningMs: number;
  private readonly stallTimeoutMs: number;

  constructor(
    private readonly handlers: GradingWatchdogHandlers,
    options: GradingWatchdogOptions = {},
  ) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? SSE_IDLE_TIMEOUT_MS;
    this.stallWarningMs = options.stallWarningMs ?? GRADING_STALL_WARNING_MS;
    this.stallTimeoutMs = options.stallTimeoutMs ?? GRADING_STALL_TIMEOUT_MS;
  }

  /** True once the warning window has elapsed with no grading progress. */
  get hasWarned(): boolean {
    return this.warned;
  }

  /** Arm the grading-liveness clocks. Call once, when the submission starts. */
  startGradingClock(): void {
    if (this.stopped) return;
    this.armStallTimers();
  }

  /**
   * (Re)arm the connection-liveness clock. Call on connect and on every
   * inbound frame, heartbeats included — this clock measures the pipe, not
   * the grade.
   */
  noteStreamActivity(): void {
    if (this.stopped) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.stopped) return;
      this.handlers.onIdleTimeout();
    }, this.idleTimeoutMs);
  }

  /** Disarm the connection clock while a reconnect is pending. */
  clearStreamActivity(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }

  /**
   * Call for every non-heartbeat frame. The server publishes to the job
   * channel only when job state actually changes, so any such frame is
   * evidence that grading advanced.
   */
  noteGradingUpdate(): void {
    if (this.stopped) return;
    this.warned = false;
    this.armStallTimers();
  }

  /** Terminal. Silences every clock; later notes are ignored. */
  stop(): void {
    this.stopped = true;
    this.clearStreamActivity();
    if (this.stallWarningTimer) {
      clearTimeout(this.stallWarningTimer);
      this.stallWarningTimer = undefined;
    }
    if (this.stallTimer) {
      clearTimeout(this.stallTimer);
      this.stallTimer = undefined;
    }
  }

  private armStallTimers(): void {
    if (this.stallWarningTimer) clearTimeout(this.stallWarningTimer);
    if (this.stallTimer) clearTimeout(this.stallTimer);

    this.stallWarningTimer = setTimeout(() => {
      if (this.stopped) return;
      this.warned = true;
      this.handlers.onStallWarning();
    }, this.stallWarningMs);

    this.stallTimer = setTimeout(() => {
      if (this.stopped) return;
      this.handlers.onStallTimeout();
    }, this.stallTimeoutMs);
  }
}
