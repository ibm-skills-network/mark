/**
 * @jest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useQueueHistory, useQueueStatus } from "../useQueueStatus";
import type { QueueStat } from "../../lib/shared";
import * as shared from "../../lib/shared";

jest.mock("../../lib/shared");

const wrapper = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

describe("useQueueStatus", () => {
  beforeEach(() => jest.clearAllMocks());

  it("fetches queue status when a token is provided", async () => {
    (shared.getQueueStatus as jest.Mock).mockResolvedValue({
      generatedAt: "t",
      queues: [],
      workers: [],
    });
    const { result } = renderHook(() => useQueueStatus("tok"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(shared.getQueueStatus).toHaveBeenCalledWith("tok");
  });

  it("is disabled without a token", () => {
    const { result } = renderHook(() => useQueueStatus(null), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(shared.getQueueStatus).not.toHaveBeenCalled();
  });
});

const buildQueue = (overrides: Partial<QueueStat>): QueueStat => ({
  name: "mark.attempt",
  waiting: 0,
  active: 0,
  delayed: 0,
  failed: 0,
  completed: 0,
  paused: 0,
  role: "learner",
  concurrencyPerPod: 4,
  livePods: 1,
  clusterCapacity: 4,
  isPaused: false,
  throughput: null,
  ...overrides,
});

describe("useQueueHistory", () => {
  it("appends a sample per queue on each new poll and bounds the buffer", () => {
    const { result, rerender } = renderHook(
      ({ queues }: { queues: QueueStat[] | undefined }) =>
        useQueueHistory(queues),
      { initialProps: { queues: [buildQueue({ failed: 1, active: 2 })] } },
    );

    expect(result.current["mark.attempt"]).toEqual([
      { waiting: 0, active: 2, failed: 1 },
    ]);

    // A new array identity (next poll) appends another sample.
    rerender({ queues: [buildQueue({ failed: 3, active: 4 })] });
    expect(result.current["mark.attempt"]).toEqual([
      { waiting: 0, active: 2, failed: 1 },
      { waiting: 0, active: 4, failed: 3 },
    ]);

    // The ring buffer never grows past 60 samples.
    for (let i = 0; i < 70; i++) {
      rerender({ queues: [buildQueue({ failed: i })] });
    }
    expect(result.current["mark.attempt"]).toHaveLength(60);
  });
});
