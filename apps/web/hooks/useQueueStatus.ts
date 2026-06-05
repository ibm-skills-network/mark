import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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
const HISTORY_MAX_SAMPLES = 60;

export function useQueueStatus(
  sessionToken: string | null | undefined,
  autoRefresh = true,
) {
  return useQuery({
    queryKey: ["admin", "queue-status", sessionToken ?? ""],
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
    refetchInterval: autoRefresh ? STATUS_POLL_MS : false,
    staleTime: STATUS_POLL_MS,
  });
}

export interface QueueHistorySample {
  waiting: number;
  active: number;
  failed: number;
}

export type QueueHistory = Record<string, QueueHistorySample[]>;

/**
 * Client-side, in-memory ring buffer of recent queue counts for sparklines.
 * Appends one sample per queue each time `queues` changes identity (i.e. each
 * poll), keeping the most recent ~5 minutes (HISTORY_MAX_SAMPLES). History is
 * intentionally ephemeral — it resets on reload. Nothing is persisted.
 */
export function useQueueHistory(queues: QueueStat[] | undefined): QueueHistory {
  const [history, setHistory] = useState<QueueHistory>({});
  const lastQueuesRef = useRef<QueueStat[] | undefined>(undefined);

  useEffect(() => {
    if (!queues || queues === lastQueuesRef.current) return;
    lastQueuesRef.current = queues;

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
  }, [queues]);

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
      queryClient.invalidateQueries({ queryKey: ["admin", "queue-status"] }),
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
