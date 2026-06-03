import { useQuery } from "@tanstack/react-query";
import { getQueueFailedJobs, getQueueStatus } from "../lib/shared";

const STATUS_POLL_MS = 5000;

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
