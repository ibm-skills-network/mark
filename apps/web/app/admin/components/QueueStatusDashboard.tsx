"use client";

import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useQueueStatus } from "@/hooks/useQueueStatus";
import { FailedJobsDialog } from "./FailedJobsDialog";
import { QueueCard } from "./QueueCard";
import { WorkersTable } from "./WorkersTable";

export function QueueStatusDashboard({
  sessionToken,
}: {
  sessionToken: string;
}) {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [inspecting, setInspecting] = useState<string | null>(null);
  const { data, isLoading, isError, refetch, isFetching } = useQueueStatus(
    sessionToken,
    autoRefresh,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Queues &amp; Workers</h1>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          <RefreshCw
            className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
          />
        </Button>
        <label className="text-sm flex items-center gap-1">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          Auto-refresh
        </label>
      </div>

      {isError ? (
        <p className="text-sm text-red-600">Failed to load queue status.</p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data?.queues.map((q) => (
              <QueueCard
                key={q.name}
                queue={q}
                onInspectFailed={setInspecting}
              />
            ))}
          </section>
          <section>
            <h2 className="text-sm font-semibold mb-2">Worker pods</h2>
            <WorkersTable workers={data?.workers ?? []} />
          </section>
        </>
      )}

      <FailedJobsDialog
        sessionToken={sessionToken}
        queueName={inspecting}
        onClose={() => setInspecting(null)}
      />
    </div>
  );
}
