import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  getQueueActiveJobs,
  getQueueFailedJobs,
  getQueueStatus,
  getRedisHealth,
  removeFailedJob,
  retryFailedJob,
  type QueueStat,
} from "../lib/shared";

const STATUS_POLL_MS = 5000;
// Redis health does an INFO + worker-list probe per poll and doesn't need 5s
// freshness, so it refreshes less often than the queue counts.
const REDIS_HEALTH_POLL_MS = 15_000;
const HISTORY_MAX_SAMPLES = 60;

const QUEUE_STATUS_KEY = ["admin", "queue-status"] as const;

export function useQueueStatus(
  sessionToken: string | null | undefined,
  autoRefresh = true,
) {
  return useQuery({
    queryKey: [...QUEUE_STATUS_KEY, sessionToken ?? ""],
    queryFn: async () => {
      if (!sessionToken) throw new Error("Session token required");
      return getQueueStatus(sessionToken);
    },
    enabled: !!sessionToken,
    refetchInterval: autoRefresh ? STATUS_POLL_MS : false,
    staleTime: STATUS_POLL_MS,
  });
}

export function useQueueFailedJobs(
  sessionToken: string | null | undefined,
  queueName: string | null,
  limit = 25,
) {
  return useQuery({
    queryKey: [
      "admin",
      "queue-failed",
      sessionToken ?? "",
      queueName ?? "",
      limit,
    ],
    queryFn: async () => {
      if (!sessionToken) throw new Error("Session token required");
      if (!queueName) throw new Error("Queue name required");
      return getQueueFailedJobs(sessionToken, queueName, limit);
    },
    enabled: !!sessionToken && !!queueName,
  });
}

export function useQueueActiveJobs(
  sessionToken: string | null | undefined,
  queueName: string | null,
  limit = 25,
) {
  return useQuery({
    queryKey: [
      "admin",
      "queue-active",
      sessionToken ?? "",
      queueName ?? "",
      limit,
    ],
    queryFn: async () => {
      if (!sessionToken) throw new Error("Session token required");
      if (!queueName) throw new Error("Queue name required");
      return getQueueActiveJobs(sessionToken, queueName, limit);
    },
    enabled: !!sessionToken && !!queueName,
  });
}

export function useRedisHealth(
  sessionToken: string | null | undefined,
  autoRefresh = true,
) {
  return useQuery({
    queryKey: ["admin", "redis-health", sessionToken ?? ""],
    queryFn: async () => {
      if (!sessionToken) throw new Error("Session token required");
      return getRedisHealth(sessionToken);
    },
    enabled: !!sessionToken,
    refetchInterval: autoRefresh ? REDIS_HEALTH_POLL_MS : false,
    staleTime: REDIS_HEALTH_POLL_MS,
  });
}

export interface QueueHistorySample {
  waiting: number;
  active: number;
  failed: number;
}

export type QueueHistory = Record<string, QueueHistorySample[]>;

/**
 * Tracks the `dataUpdatedAt` of the queue-status query straight from the cache.
 * React Query bumps this on every successful fetch even when structural sharing
 * hands back a deeply-equal (same-reference) payload, so it is a reliable
 * per-poll signal — unlike the identity of the polled `queues` array, which
 * stays stable while an idle queue's counts don't change.
 */
function useQueueStatusUpdatedAt(): number {
  const queryClient = useQueryClient();
  const cache = queryClient.getQueryCache();

  const read = () =>
    cache.find({ queryKey: [...QUEUE_STATUS_KEY], exact: false })?.state
      .dataUpdatedAt ?? 0;

  return useSyncExternalStore(
    (onChange) => cache.subscribe(onChange),
    read,
    read,
  );
}

/**
 * Client-side, in-memory ring buffer of recent queue counts for sparklines.
 * Appends one sample per queue per successful poll — keyed off the queue-status
 * query's `dataUpdatedAt` rather than the identity of the `queues` array, so
 * every queue advances in lockstep even when an idle queue's counts (and thus
 * its array reference under structural sharing) don't change. Keeps the most
 * recent ~5 minutes (HISTORY_MAX_SAMPLES). History is intentionally ephemeral —
 * it resets on reload. Nothing is persisted.
 */
export function useQueueHistory(queues: QueueStat[] | undefined): QueueHistory {
  const [history, setHistory] = useState<QueueHistory>({});
  const updatedAt = useQueueStatusUpdatedAt();
  const lastUpdatedAtRef = useRef<number>(0);

  useEffect(() => {
    // Dedupe by poll timestamp: a re-render without a fresh fetch leaves
    // `updatedAt` unchanged and must not double-append.
    if (!queues || updatedAt === 0 || updatedAt === lastUpdatedAtRef.current) {
      return;
    }
    lastUpdatedAtRef.current = updatedAt;

    setHistory((previous) => {
      const next: QueueHistory = {};
      for (const queue of queues) {
        const prior = previous[queue.name] ?? [];
        const sample: QueueHistorySample = {
          waiting: queue.waiting,
          active: queue.active,
          failed: queue.failed,
        };
        next[queue.name] = [...prior, sample].slice(-HISTORY_MAX_SAMPLES);
      }
      return next;
    });
  }, [queues, updatedAt]);

  return history;
}

/**
 * Retry / remove mutations for a single failed job. On success they invalidate
 * the failed-jobs and queue-status queries so the dialog and cards reflect the
 * change without a manual refresh.
 */
export function useQueueJobActions(sessionToken: string | null | undefined) {
  const queryClient = useQueryClient();

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin", "queue-failed"] }),
      queryClient.invalidateQueries({ queryKey: [...QUEUE_STATUS_KEY] }),
    ]);
  };

  const retry = useMutation({
    mutationFn: async (variables: { queueName: string; jobId: string }) => {
      if (!sessionToken) throw new Error("Session token required");
      return retryFailedJob(sessionToken, variables.queueName, variables.jobId);
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (variables: { queueName: string; jobId: string }) => {
      if (!sessionToken) throw new Error("Session token required");
      return removeFailedJob(
        sessionToken,
        variables.queueName,
        variables.jobId,
      );
    },
    onSuccess: invalidate,
  });

  return { retry, remove };
}
