/**
 * @jest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useQueueHistory, useQueueStatus } from "../useQueueStatus";
import type { QueueStat, QueueStatusResponse } from "../../lib/shared";
import * as shared from "../../lib/shared";

jest.mock("../../lib/shared");

// Mirrors the queue-status query key used by useQueueStatus (token is "").
const QUEUE_STATUS_KEY = ["admin", "queue-status", ""] as const;

const makeWrapper = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

describe("useQueueStatus", () => {
  beforeEach(() => jest.clearAllMocks());

  it("fetches queue status when a token is provided", async () => {
    const wrapper = makeWrapper(
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    );
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
    const wrapper = makeWrapper(
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    );
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

const buildResponse = (queues: QueueStat[]): QueueStatusResponse => ({
  generatedAt: "t",
  queues,
  workers: [],
});

describe("useQueueHistory", () => {
  // Seed the queue-status query in the cache with an explicit dataUpdatedAt so
  // each poll has a distinct timestamp — this is the signal the hook dedupes on.
  // Seeds the cache for the very first render (no React root mounted yet).
  const seed = (
    client: QueryClient,
    queues: QueueStat[],
    updatedAt: number,
  ) => {
    client.setQueryData([...QUEUE_STATUS_KEY], buildResponse(queues), {
      updatedAt,
    });
  };

  // A subsequent poll updates the cache timestamp *and* the `queues` prop
  // together — mirroring production, where `data` (passed to the hook) and the
  // query's `dataUpdatedAt` advance atomically on each successful fetch.
  const poll = (
    client: QueryClient,
    rerender: (props: { queues: QueueStat[] | undefined }) => void,
    queues: QueueStat[],
    updatedAt: number,
  ) => {
    act(() => {
      client.setQueryData([...QUEUE_STATUS_KEY], buildResponse(queues), {
        updatedAt,
      });
      rerender({ queues });
    });
  };

  it("appends a sample per queue on each new poll and bounds the buffer", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = makeWrapper(client);

    const first = [buildQueue({ failed: 1, active: 2 })];
    seed(client, first, 1000);

    const { result, rerender } = renderHook(
      ({ queues }: { queues: QueueStat[] | undefined }) =>
        useQueueHistory(queues),
      { wrapper, initialProps: { queues: first } },
    );

    expect(result.current["mark.attempt"]).toEqual([
      { waiting: 0, active: 2, failed: 1 },
    ]);

    // A fresh poll (new timestamp) appends another sample.
    const second = [buildQueue({ failed: 3, active: 4 })];
    poll(client, rerender, second, 2000);
    expect(result.current["mark.attempt"]).toEqual([
      { waiting: 0, active: 2, failed: 1 },
      { waiting: 0, active: 4, failed: 3 },
    ]);

    // The ring buffer never grows past 60 samples.
    for (let i = 0; i < 70; i++) {
      poll(client, rerender, [buildQueue({ failed: i })], 3000 + i);
    }
    expect(result.current["mark.attempt"]).toHaveLength(60);
  });

  it("advances each poll even when the queues array keeps the same reference", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = makeWrapper(client);

    // An idle queue: React Query's structural sharing hands back the *same*
    // array reference across polls because the counts are deeply equal.
    const idle = [buildQueue({ waiting: 0, active: 0, failed: 0 })];

    seed(client, idle, 1000);
    const { result, rerender } = renderHook(
      ({ queues }: { queues: QueueStat[] | undefined }) =>
        useQueueHistory(queues),
      { wrapper, initialProps: { queues: idle } },
    );
    expect(result.current["mark.attempt"]).toHaveLength(1);

    // Same reference, but a new poll timestamp — must still append.
    poll(client, rerender, idle, 2000);
    expect(result.current["mark.attempt"]).toEqual([
      { waiting: 0, active: 0, failed: 0 },
      { waiting: 0, active: 0, failed: 0 },
    ]);

    // A re-render with no fresh poll (timestamp unchanged) must NOT double-append.
    act(() => {
      rerender({ queues: idle });
    });
    expect(result.current["mark.attempt"]).toHaveLength(2);
  });
});
