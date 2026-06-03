import { useQuery } from "@tanstack/react-query";
import { getQueueFailedJobs, getQueueStatus } from "../lib/shared";

const STATUS_POLL_MS = 5000;

export function useQueueStatus(
  sessionToken: string | null | undefined,
  autoRefresh = true,
) {
  return useQuery({
    queryKey: ["admin", "queue-status", sessionToken ?? ""],
    queryFn: () => getQueueStatus(sessionToken),
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
    queryFn: () => getQueueFailedJobs(sessionToken, queueName, limit),
    enabled: !!sessionToken && !!queueName,
  });
}
