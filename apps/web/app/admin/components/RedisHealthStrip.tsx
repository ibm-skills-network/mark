"use client";

import { Badge } from "@/components/ui/badge";
import { useRedisHealth } from "@/hooks/useQueueStatus";

function formatNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toLocaleString();
}

export function RedisHealthStrip({
  sessionToken,
  autoRefresh = true,
}: {
  sessionToken: string;
  autoRefresh?: boolean;
}) {
  const { data, isLoading, isError } = useRedisHealth(
    sessionToken,
    autoRefresh,
  );

  return (
    <section className="rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="text-sm font-semibold">Redis health</h2>
        {data ? (
          <Badge variant={data.reconciled ? "secondary" : "destructive"}>
            {data.reconciled ? "reconciled" : "mismatch"}
          </Badge>
        ) : null}
      </div>
      {isError ? (
        <p className="text-sm text-red-600">Could not load Redis health.</p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : data ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
          <Metric
            label="memory"
            value={data.usedMemoryHuman ?? formatBytes(data.usedMemoryBytes)}
          />
          <Metric label="clients" value={formatNumber(data.connectedClients)} />
          <Metric label="ops/sec" value={formatNumber(data.opsPerSec)} />
          <Metric
            label="worker conns"
            value={data.workerConnections.toString()}
          />
          <Metric label="live pods" value={data.heartbeatPods.toString()} />
          <Metric label="reconciled" value={data.reconciled ? "yes" : "no"} />
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="font-semibold font-mono">{value}</div>
    </div>
  );
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  return `${(bytes / 1024 ** index).toFixed(1)} ${units[index]}`;
}
