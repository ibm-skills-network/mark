/**
 * @jest-environment node
 */

jest.mock("../api-client", () => ({
  apiClient: { patch: jest.fn(), post: jest.fn() },
  APIError: class APIError extends Error {},
}));

jest.mock("sonner", () => ({
  toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() },
}));

jest.mock("@/lib/talkToBackend", () => ({
  submitReportAuthor: jest.fn().mockResolvedValue({ success: true }),
}));

import { apiClient } from "../api-client";
import {
  GRADING_STALL_TIMEOUT_MS,
  GRADING_STALL_WARNING_MS,
  SSE_IDLE_TIMEOUT_MS,
} from "../grading-stream-watchdog";
import {
  isGradingStreamLostError,
  submitAssignment,
  type GradingProgressStatus,
} from "../learner";

type Listener = (event: { data?: string }) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: Listener | null = null;
  closed = false;

  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  close(): void {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }

  emit(type: string, data?: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data });
    }
  }

  open(): void {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }
}

const heartbeat = () =>
  JSON.stringify({ heartbeat: true, jobId: "job-1", timestamp: "now" });

const progressFrame = (
  percentage: number,
  metadata?: { currentQuestion?: number; totalQuestions?: number },
) =>
  JSON.stringify({
    jobId: "job-1",
    status: "Processing",
    progress: `Grading ${percentage}%`,
    percentage,
    currentQuestion: metadata?.currentQuestion,
    totalQuestions: metadata?.totalQuestions,
    done: false,
  });

interface ProgressCall {
  status: GradingProgressStatus;
  progress: number;
  message: string;
  metadata?: { currentQuestion?: number; totalQuestions?: number };
}

beforeEach(() => {
  jest.useFakeTimers();
  FakeEventSource.instances = [];
  (globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;
  (apiClient.patch as jest.Mock).mockResolvedValue({
    gradingJobId: "job-1",
    message: "queued",
  });
  (apiClient.post as jest.Mock).mockResolvedValue({ success: true });
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  delete (globalThis as { EventSource?: unknown }).EventSource;
});

/** Flush the microtask queue so awaited internals settle between tick pushes. */
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("submitAssignment connection watchdog", () => {
  it("does not give up while heartbeats keep arriving", async () => {
    const statuses: GradingProgressStatus[] = [];
    const pending = submitAssignment(
      1,
      2,
      [],
      "en",
      undefined,
      undefined,
      undefined,
      (status) => {
        statuses.push(status);
      },
    );
    void pending.catch(() => undefined);

    await flush();
    const source = FakeEventSource.instances[0];
    source.open();

    for (
      let elapsed = 0;
      elapsed < SSE_IDLE_TIMEOUT_MS * 3;
      elapsed += 10_000
    ) {
      jest.advanceTimersByTime(10_000);
      source.emit("heartbeat", heartbeat());
    }

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(statuses).not.toContain("disconnected");
  });

  it("reconnects and then reports a lost stream once the retries run out", async () => {
    const statuses: GradingProgressStatus[] = [];
    const pending = submitAssignment(
      1,
      2,
      [],
      "en",
      undefined,
      undefined,
      undefined,
      (status) => {
        statuses.push(status);
      },
    );
    const settled = pending.catch((error: unknown) => error);

    await flush();
    FakeEventSource.instances[0].open();

    // Attempt 1 goes silent.
    jest.advanceTimersByTime(SSE_IDLE_TIMEOUT_MS);
    await flush();
    jest.advanceTimersByTime(2000);
    await flush();
    expect(FakeEventSource.instances).toHaveLength(2);

    // Attempt 2 goes silent.
    jest.advanceTimersByTime(SSE_IDLE_TIMEOUT_MS);
    await flush();
    jest.advanceTimersByTime(4000);
    await flush();
    expect(FakeEventSource.instances).toHaveLength(3);

    // Attempt 3 goes silent — no attempts left.
    jest.advanceTimersByTime(SSE_IDLE_TIMEOUT_MS);
    await flush();
    await jest.runOnlyPendingTimersAsync();

    const error = await settled;
    expect(isGradingStreamLostError(error)).toBe(true);
    expect(statuses).toContain("disconnected");
  });

  it("surfaces a stall without closing a connection that is still alive, carrying the last-known progress forward instead of resetting it", async () => {
    const calls: ProgressCall[] = [];
    const pending = submitAssignment(
      1,
      2,
      [],
      "en",
      undefined,
      undefined,
      undefined,
      (status, progress, message, metadata) => {
        calls.push({ status, progress, message, metadata });
      },
    );
    void pending.catch(() => undefined);

    await flush();
    const source = FakeEventSource.instances[0];
    source.open();

    // Real progress arrives before the stall — this is what the warning
    // must not wipe out.
    source.emit(
      "update",
      progressFrame(55, { currentQuestion: 3, totalQuestions: 10 }),
    );

    for (
      let elapsed = 0;
      elapsed < GRADING_STALL_WARNING_MS;
      elapsed += 10_000
    ) {
      jest.advanceTimersByTime(10_000);
      source.emit("heartbeat", heartbeat());
    }

    const statuses = calls.map((c) => c.status);
    expect(statuses).toContain("stalled");
    expect(source.closed).toBe(false);
    expect(FakeEventSource.instances).toHaveLength(1);

    const stalledCall = calls.find((c) => c.status === "stalled");
    expect(stalledCall).toBeDefined();
    expect(stalledCall?.progress).toBe(55);
    expect(stalledCall?.metadata?.currentQuestion).toBe(3);
    expect(stalledCall?.metadata?.totalQuestions).toBe(10);
  });

  it("clears the stall once real progress resumes, and genuinely re-arms the grading clock rather than just reporting a status once", async () => {
    const statuses: GradingProgressStatus[] = [];
    const pending = submitAssignment(
      1,
      2,
      [],
      "en",
      undefined,
      undefined,
      undefined,
      (status) => {
        statuses.push(status);
      },
    );
    void pending.catch(() => undefined);

    await flush();
    const source = FakeEventSource.instances[0];
    source.open();

    for (
      let elapsed = 0;
      elapsed < GRADING_STALL_WARNING_MS;
      elapsed += 10_000
    ) {
      jest.advanceTimersByTime(10_000);
      source.emit("heartbeat", heartbeat());
    }
    expect(statuses).toContain("stalled");

    source.emit("update", progressFrame(40));
    expect(statuses[statuses.length - 1]).toBe("processing");

    // The update above must have re-armed the grading-liveness clock itself,
    // not just cleared the displayed status. Feed it another full warning
    // window of heartbeats alone (no further real progress) and confirm the
    // stall fires again — a second "stalled" only appears if the clock was
    // genuinely rescheduled from the update, not left running from the
    // first arm (in which case it would already have fired once and never
    // again).
    const stalledCountAfterFirstWarning = statuses.filter(
      (s) => s === "stalled",
    ).length;

    for (
      let elapsed = 0;
      elapsed < GRADING_STALL_WARNING_MS;
      elapsed += 10_000
    ) {
      jest.advanceTimersByTime(10_000);
      source.emit("heartbeat", heartbeat());
    }

    const stalledCountAfterSecondWindow = statuses.filter(
      (s) => s === "stalled",
    ).length;
    expect(stalledCountAfterSecondWindow).toBeGreaterThan(
      stalledCountAfterFirstWarning,
    );
  });

  it("rejects the caller and reports 'disconnected' even when the diagnostic report never resolves", async () => {
    // A dead network can hang the report POST (and its author-report
    // fallback) indefinitely. The whole point of this watchdog is a bounded
    // time-to-honest-state, so the learner must not be left waiting on a
    // network call that may never settle.
    (apiClient.post as jest.Mock).mockReturnValue(new Promise(() => undefined));

    const statuses: GradingProgressStatus[] = [];
    const pending = submitAssignment(
      1,
      2,
      [],
      "en",
      undefined,
      undefined,
      undefined,
      (status) => {
        statuses.push(status);
      },
    );
    const settled = pending.catch((error: unknown) => error);

    await flush();
    FakeEventSource.instances[0].open();

    jest.advanceTimersByTime(SSE_IDLE_TIMEOUT_MS);
    await flush();
    jest.advanceTimersByTime(2000);
    await flush();

    jest.advanceTimersByTime(SSE_IDLE_TIMEOUT_MS);
    await flush();
    jest.advanceTimersByTime(4000);
    await flush();

    jest.advanceTimersByTime(SSE_IDLE_TIMEOUT_MS);
    await flush();

    const error = await settled;
    expect(isGradingStreamLostError(error)).toBe(true);
    expect(statuses).toContain("disconnected");
  });

  it("hard-stops a wedged grade with a lost-stream error", async () => {
    const statuses: GradingProgressStatus[] = [];
    const pending = submitAssignment(
      1,
      2,
      [],
      "en",
      undefined,
      undefined,
      undefined,
      (status) => {
        statuses.push(status);
      },
    );
    const settled = pending.catch((error: unknown) => error);

    await flush();
    const source = FakeEventSource.instances[0];
    source.open();

    for (
      let elapsed = 0;
      elapsed < GRADING_STALL_TIMEOUT_MS;
      elapsed += 10_000
    ) {
      jest.advanceTimersByTime(10_000);
      source.emit("heartbeat", heartbeat());
    }

    await flush();
    await jest.runOnlyPendingTimersAsync();

    const error = await settled;
    expect(isGradingStreamLostError(error)).toBe(true);
    expect((error as { reason?: string }).reason).toBe("stalled");
    expect(statuses).toContain("disconnected");
  });

  it("still resolves normally on a finalize frame", async () => {
    const pending = submitAssignment(1, 2, []);

    await flush();
    const source = FakeEventSource.instances[0];
    source.open();
    source.emit(
      "finalize",
      JSON.stringify({
        jobId: "job-1",
        status: "Completed",
        result: JSON.stringify({ id: 2, grade: 0.9 }),
        done: true,
      }),
    );

    await expect(pending).resolves.toMatchObject({ id: 2, grade: 0.9 });
    expect(source.closed).toBe(true);
  });
});
