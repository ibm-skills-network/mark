"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useQueueFailedJobs } from "@/hooks/useQueueStatus";

export function FailedJobsDialog({
  sessionToken,
  queueName,
  onClose,
}: {
  sessionToken: string;
  queueName: string | null;
  onClose: () => void;
}) {
  const { data, isLoading } = useQueueFailedJobs(sessionToken, queueName);
  return (
    <Dialog
      open={!!queueName}
      onOpenChange={(open) => (!open ? onClose() : null)}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">
            Failed jobs — {queueName}
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (data?.failed.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">No failed jobs.</p>
        ) : (
          <ul className="space-y-3 max-h-[60vh] overflow-auto">
            {data?.failed.map((job) => (
              <li key={job.id} className="border rounded p-2 text-sm">
                <div className="flex justify-between">
                  <span className="font-mono">
                    {job.name}#{job.id}
                  </span>
                  <span className="text-muted-foreground">
                    {job.attemptsMade}/{job.maxAttempts} · {job.failedAt ?? "—"}
                  </span>
                </div>
                <div className="text-red-600 break-words">
                  {job.failedReason}
                </div>
                {Object.keys(job.domainIds).length > 0 ? (
                  <div className="text-xs text-muted-foreground mt-1">
                    {Object.entries(job.domainIds)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(" · ")}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
