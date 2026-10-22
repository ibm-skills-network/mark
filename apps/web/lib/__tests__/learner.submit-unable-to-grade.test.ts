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

import { toast } from "sonner";
import { submitReportAuthor } from "@/lib/talkToBackend";
import { apiClient } from "../api-client";
import { isGradingUnableError } from "../grading-failure";
import { submitAssignment, type GradingProgressStatus } from "../learner";

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
}

interface ProgressCall {
  status: GradingProgressStatus;
  message: string;
  metadata?: { failure?: unknown };
}

const unableFailure = {
  kind: "unable_to_grade",
  issues: [
    {
      questionId: 41,
      code: "url_unreachable",
      source: {
        kind: "url",
        url: "https://github.com/me/private",
        httpStatus: 404,
      },
      retryable: false,
      message: "We couldn't open your link.",
    },
  ],
};

const failedFrame = (failure?: unknown) =>
  JSON.stringify({
    jobId: "job-1",
    status: "Failed",
    progress: "Question 1: we couldn't open your link",
    percentage: 0,
    done: true,
    ...(failure === undefined ? {} : { failure }),
  });

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
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

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

async function startSubmit() {
  const calls: ProgressCall[] = [];
  const pending = submitAssignment(
    1,
    2,
    [],
    "en",
    undefined,
    undefined,
    undefined,
    (status, _progress, message, metadata) => {
      calls.push({ status, message, metadata });
    },
  );
  const settled = pending.then(
    () => undefined,
    (error: unknown) => error,
  );
  await flush();
  return { calls, settled, source: FakeEventSource.instances[0] };
}

describe("submitAssignment: learner-fixable grading failure", () => {
  it.each(["error", "message"])(
    "reports unable_to_grade with the failure and never toasts or files a report (%s event)",
    async (channel) => {
      const { calls, settled, source } = await startSubmit();

      if (channel === "error") source.emit("error", failedFrame(unableFailure));
      else source.onmessage?.({ data: failedFrame(unableFailure) });

      await jest.runOnlyPendingTimersAsync();
      const error = await settled;

      const terminal = calls[calls.length - 1];
      expect(terminal.status).toBe("unable_to_grade");
      expect(terminal.metadata?.failure).toEqual(unableFailure);
      expect(isGradingUnableError(error)).toBe(true);
      expect(toast.error).not.toHaveBeenCalled();
      expect(submitReportAuthor).not.toHaveBeenCalled();
      expect((apiClient.post as jest.Mock).mock.calls).toHaveLength(0);
    },
  );
});

describe("submitAssignment: real grading failure", () => {
  it.each([
    ["no failure (older server)", undefined],
    ["kind grading_failed", { kind: "grading_failed", issues: [] }],
    ["an unknown kind", { kind: "something_new", issues: [] }],
    ["a malformed failure", "not an object"],
    [
      "unable_to_grade with no usable issues",
      {
        kind: "unable_to_grade",
        issues: [{ questionId: "x" }],
      },
    ],
  ])("keeps today's red failure path for %s", async (_label, failure) => {
    const { calls, settled, source } = await startSubmit();

    source.emit("error", failedFrame(failure));
    expect(calls[calls.length - 1].status).toBe("failed");
    expect(calls[calls.length - 1].message).toBe(
      "Question 1: we couldn't open your link",
    );
    expect(toast.error).not.toHaveBeenCalled();

    jest.advanceTimersByTime(2000);
    const error = await settled;

    expect(toast.error).toHaveBeenCalledWith(
      "Question 1: we couldn't open your link",
    );
    expect(isGradingUnableError(error)).toBe(false);
    expect(error).toBeInstanceOf(Error);
  });
});
