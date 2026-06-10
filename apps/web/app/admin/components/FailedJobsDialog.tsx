"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useQueueFailedJobs, useQueueJobActions } from "@/hooks/useQueueStatus";
import { formatFileSize, type FailedJob } from "@/lib/shared";

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toLocaleString();
}

export function FailedJobsDialog({
  sessionToken,
  queueName,
  onClose,
}: {
  sessionToken: string;
  queueName: string | null;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useQueueFailedJobs(
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
            Failed jobs — {queueName}
          </DialogTitle>
        </DialogHeader>
        {isError ? (
          <p className="text-sm text-red-600">
            Could not load failed jobs for this queue.
          </p>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (data?.failed.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">No failed jobs.</p>
        ) : (
          <ul className="space-y-3 max-h-[60vh] overflow-auto">
            {data?.failed.map((job) => (
              <FailedJobRow
                key={job.id}
                sessionToken={sessionToken}
                queueName={queueName ?? ""}
                job={job}
              />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FailedJobRow({
  sessionToken,
  queueName,
  job,
}: {
  sessionToken: string;
  queueName: string;
  job: FailedJob;
}) {
  const [stackOpen, setStackOpen] = useState(false);
  const [confirming, setConfirming] = useState<"retry" | "remove" | null>(null);
  const { retry, remove } = useQueueJobActions(sessionToken);

  const isPending = retry.isPending || remove.isPending;
  const domainEntries = Object.entries(job.domainIds);

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

      <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <div>
          <dt className="inline">enqueued: </dt>
          <dd className="inline">{formatTimestamp(job.enqueuedAt)}</dd>
        </div>
        <div>
          <dt className="inline">started: </dt>
          <dd className="inline">{formatTimestamp(job.processedAt)}</dd>
        </div>
        <div>
          <dt className="inline">finished: </dt>
          <dd className="inline">{formatTimestamp(job.finishedAt)}</dd>
        </div>
        <div>
          <dt className="inline">failed: </dt>
          <dd className="inline">{formatTimestamp(job.failedAt)}</dd>
        </div>
      </dl>

      <div className="text-red-600 break-words">{job.failedReason}</div>

      {domainEntries.length > 0 ? (
        <div className="text-xs text-muted-foreground">
          {domainEntries.map(([key, value]) => `${key}=${value}`).join(" · ")}
        </div>
      ) : null}

      {job.files.length > 0 ? (
        <ul className="space-y-1">
          {job.files.map((file, index) => (
            <li
              key={`${file.filename}-${index}`}
              className="flex flex-wrap items-center gap-2 text-xs"
            >
              <span className="font-mono break-all">{file.filename}</span>
              {file.mimeType ? (
                <span className="text-muted-foreground">{file.mimeType}</span>
              ) : null}
              {typeof file.sizeBytes === "number" ? (
                <span className="text-muted-foreground">
                  {formatFileSize(file.sizeBytes)}
                </span>
              ) : null}
              {file.downloadUrl ? (
                <a
                  href={file.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 underline"
                >
                  Open file ↗
                </a>
              ) : (
                <span className="text-muted-foreground">
                  (no link available)
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {job.stacktrace.length > 0 ? (
        <div>
          <button
            type="button"
            onClick={() => setStackOpen((open) => !open)}
            className="text-xs text-muted-foreground underline cursor-pointer"
          >
            {stackOpen ? "Hide" : "Show"} stacktrace ({job.stacktrace.length})
          </button>
          {stackOpen ? (
            <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted p-2 text-[11px] whitespace-pre-wrap break-words">
              {job.stacktrace.join("\n")}
            </pre>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center gap-2 pt-1">
        {confirming === null ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => setConfirming("retry")}
            >
              Retry
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={isPending}
              onClick={() => setConfirming("remove")}
            >
              Remove
            </Button>
          </>
        ) : (
          <>
            <span className="text-xs text-muted-foreground">
              {confirming === "retry" ? "Retry this job?" : "Remove this job?"}
            </span>
            <Button
              type="button"
              variant={confirming === "remove" ? "destructive" : "default"}
              size="sm"
              disabled={isPending}
              onClick={() => {
                const action = confirming === "retry" ? retry : remove;
                action.mutate(
                  { queueName, jobId: job.id },
                  { onSettled: () => setConfirming(null) },
                );
              }}
            >
              {isPending ? "Working…" : "Confirm"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={() => setConfirming(null)}
            >
              Cancel
            </Button>
          </>
        )}
        {retry.isError && confirming === null ? (
          <span className="text-xs text-red-600">Retry failed.</span>
        ) : null}
        {remove.isError && confirming === null ? (
          <span className="text-xs text-red-600">Remove failed.</span>
        ) : null}
      </div>
    </li>
  );
}
