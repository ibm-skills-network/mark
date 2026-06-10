"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useQueueActiveJobs } from "@/hooks/useQueueStatus";
import type { ActiveJob } from "@/lib/shared";

function formatRunningFor(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function progressPercent(progress: ActiveJob["progress"]): number | null {
  if (typeof progress === "number" && Number.isFinite(progress)) {
    // BullMQ reports progress either as a 0..100 percentage or, less commonly,
    // a 0..1 fraction. Only a non-integer strictly between 0 and 1 is treated
    // as a fraction; everything else (including an exact 1, meaning 1%) is
    // already on the percentage scale.
    const isFraction = progress > 0 && progress < 1;
    const value = isFraction ? progress * 100 : progress;
    return Math.max(0, Math.min(100, value));
  }
  return null;
}

export function ActiveJobsDialog({
  sessionToken,
  queueName,
  onClose,
}: {
  sessionToken: string;
  queueName: string | null;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useQueueActiveJobs(
    sessionToken,
    queueName,
  );

  return (
    <Dialog
      open={!!queueName}
      onOpenChange={(open) => (!open ? onClose() : null)}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">
            Active jobs — {queueName}
          </DialogTitle>
        </DialogHeader>
        {isError ? (
          <p className="text-sm text-red-600">
            Could not load active jobs for this queue.
          </p>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (data?.active.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">No active jobs.</p>
        ) : (
          <ul className="space-y-3 max-h-[60vh] overflow-auto">
            {data?.active.map((job) => (
              <ActiveJobRow key={job.id} job={job} />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ActiveJobRow({ job }: { job: ActiveJob }) {
  const pct = progressPercent(job.progress);
  const domainEntries = Object.entries(job.domainIds);
  const objectProgress =
    pct === null && job.progress && typeof job.progress === "object"
      ? JSON.stringify(job.progress)
      : null;

  return (
    <li className="border rounded p-2 text-sm space-y-2">
      <div className="flex justify-between gap-2">
        <span className="font-mono break-all">
          {job.name}#{job.id}
        </span>
        <span className="text-muted-foreground whitespace-nowrap">
          {job.attemptsMade}/{job.maxAttempts} attempts
        </span>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span>running for {formatRunningFor(job.runningForMs)}</span>
        <span>pod: {job.processedBy ?? "—"}</span>
      </div>

      {pct !== null ? (
        <div className="space-y-1">
          <div
            className="h-2 w-full overflow-hidden rounded bg-muted"
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full bg-blue-500" style={{ width: `${pct}%` }} />
          </div>
          <div className="text-[10px] text-muted-foreground">
            {Math.round(pct)}%
          </div>
        </div>
      ) : objectProgress ? (
        <div className="text-xs text-muted-foreground break-words">
          {objectProgress}
        </div>
      ) : null}

      {domainEntries.length > 0 ? (
        <div className="text-xs text-muted-foreground">
          {domainEntries.map(([key, value]) => `${key}=${value}`).join(" · ")}
        </div>
      ) : null}
    </li>
  );
}
