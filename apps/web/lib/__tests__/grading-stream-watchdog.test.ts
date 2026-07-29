/**
 * @jest-environment node
 */

import {
  GRADING_STALL_TIMEOUT_MS,
  GRADING_STALL_WARNING_MS,
  GradingWatchdog,
  SSE_IDLE_TIMEOUT_MS,
  SSE_MAX_CONNECTION_ATTEMPTS,
} from "../grading-stream-watchdog";

const handlers = () => ({
  onIdleTimeout: jest.fn(),
  onStallWarning: jest.fn(),
  onStallTimeout: jest.fn(),
});

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe("watchdog budgets", () => {
  it("gives a dead connection an honest outcome inside three minutes", () => {
    // Worst case = idle timeout per attempt plus the linear reconnect backoff
    // between them. This is the number that used to be ~15 minutes.
    const backoff = 2000 + 4000;
    const worstCase =
      SSE_IDLE_TIMEOUT_MS * SSE_MAX_CONNECTION_ATTEMPTS + backoff;

    expect(worstCase).toBeLessThanOrEqual(180_000);
  });

  it("keeps the idle budget well clear of the server heartbeat cadence", () => {
    const serverHeartbeatIntervalMs = 10_000;

    expect(SSE_IDLE_TIMEOUT_MS).toBeGreaterThanOrEqual(
      serverHeartbeatIntervalMs * 4,
    );
  });

  it("keeps the hard stall stop above the worker's own dead-worker detection", () => {
    // Attempt lock duration (600000) plus one stall-check tick (30000). Below
    // this the client would pre-empt a failure the server is about to report
    // properly.
    expect(GRADING_STALL_TIMEOUT_MS).toBeGreaterThan(630_000);
    expect(GRADING_STALL_WARNING_MS).toBeLessThan(GRADING_STALL_TIMEOUT_MS);
  });
});

describe("connection idle clock", () => {
  it("fires when nothing at all arrives", () => {
    const h = handlers();
    const watchdog = new GradingWatchdog(h);

    watchdog.noteStreamActivity();
    jest.advanceTimersByTime(SSE_IDLE_TIMEOUT_MS - 1);
    expect(h.onIdleTimeout).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(h.onIdleTimeout).toHaveBeenCalledTimes(1);
  });

  it("is re-armed by a heartbeat, so a live-but-slow grade is never cut off", () => {
    const h = handlers();
    const watchdog = new GradingWatchdog(h);

    watchdog.startGradingClock();
    watchdog.noteStreamActivity();

    for (
      let elapsed = 0;
      elapsed < GRADING_STALL_WARNING_MS;
      elapsed += 10_000
    ) {
      jest.advanceTimersByTime(10_000);
      watchdog.noteStreamActivity();
    }

    expect(h.onIdleTimeout).not.toHaveBeenCalled();
  });

  it("stops firing once the connection is torn down", () => {
    const h = handlers();
    const watchdog = new GradingWatchdog(h);

    watchdog.noteStreamActivity();
    watchdog.clearStreamActivity();
    jest.advanceTimersByTime(SSE_IDLE_TIMEOUT_MS * 2);

    expect(h.onIdleTimeout).not.toHaveBeenCalled();
  });
});

describe("grading stall clock", () => {
  it("warns when only heartbeats arrive for the warning window", () => {
    const h = handlers();
    const watchdog = new GradingWatchdog(h);

    watchdog.startGradingClock();

    for (
      let elapsed = 0;
      elapsed < GRADING_STALL_WARNING_MS;
      elapsed += 10_000
    ) {
      jest.advanceTimersByTime(10_000);
      watchdog.noteStreamActivity();
    }

    expect(h.onStallWarning).toHaveBeenCalledTimes(1);
    expect(h.onStallTimeout).not.toHaveBeenCalled();
    expect(watchdog.hasWarned).toBe(true);
  });

  it("hard-stops when the stall outlasts the timeout window", () => {
    const h = handlers();
    const watchdog = new GradingWatchdog(h);

    watchdog.startGradingClock();
    jest.advanceTimersByTime(GRADING_STALL_TIMEOUT_MS);

    expect(h.onStallTimeout).toHaveBeenCalledTimes(1);
  });

  it("is re-armed by a substantive update and clears the warning", () => {
    const h = handlers();
    const watchdog = new GradingWatchdog(h);

    watchdog.startGradingClock();
    jest.advanceTimersByTime(GRADING_STALL_WARNING_MS);
    expect(watchdog.hasWarned).toBe(true);

    watchdog.noteGradingUpdate();
    expect(watchdog.hasWarned).toBe(false);

    jest.advanceTimersByTime(GRADING_STALL_WARNING_MS - 1);
    expect(h.onStallWarning).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1);
    expect(h.onStallWarning).toHaveBeenCalledTimes(2);
    expect(h.onStallTimeout).not.toHaveBeenCalled();
  });

  it("survives a reconnect: the grading clock is not reset by the new connection alone", () => {
    const h = handlers();
    const watchdog = new GradingWatchdog(h);

    watchdog.startGradingClock();
    jest.advanceTimersByTime(GRADING_STALL_WARNING_MS - 1000);

    // Connection drops and comes back; only connection-level state resets.
    watchdog.clearStreamActivity();
    watchdog.noteStreamActivity();

    jest.advanceTimersByTime(1000);
    expect(h.onStallWarning).toHaveBeenCalledTimes(1);
  });
});

describe("stop()", () => {
  it("silences every clock", () => {
    const h = handlers();
    const watchdog = new GradingWatchdog(h);

    watchdog.startGradingClock();
    watchdog.noteStreamActivity();
    watchdog.stop();

    jest.advanceTimersByTime(GRADING_STALL_TIMEOUT_MS * 2);

    expect(h.onIdleTimeout).not.toHaveBeenCalled();
    expect(h.onStallWarning).not.toHaveBeenCalled();
    expect(h.onStallTimeout).not.toHaveBeenCalled();
  });

  it("ignores activity notes after stopping", () => {
    const h = handlers();
    const watchdog = new GradingWatchdog(h);

    watchdog.stop();
    watchdog.startGradingClock();
    watchdog.noteStreamActivity();
    watchdog.noteGradingUpdate();

    jest.advanceTimersByTime(GRADING_STALL_TIMEOUT_MS * 2);

    expect(h.onIdleTimeout).not.toHaveBeenCalled();
    expect(h.onStallTimeout).not.toHaveBeenCalled();
  });
});

describe("option overrides", () => {
  it("honours injected windows so callers can test fast", () => {
    const h = handlers();
    const watchdog = new GradingWatchdog(h, {
      idleTimeoutMs: 50,
      stallWarningMs: 100,
      stallTimeoutMs: 200,
    });

    watchdog.startGradingClock();
    watchdog.noteStreamActivity();

    jest.advanceTimersByTime(50);
    expect(h.onIdleTimeout).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(50);
    expect(h.onStallWarning).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(100);
    expect(h.onStallTimeout).toHaveBeenCalledTimes(1);
  });
});
