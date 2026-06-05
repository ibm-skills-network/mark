"use client";

import { Badge } from "@/components/ui/badge";
import type { QueueStatusResponse } from "@/lib/shared";

const fmtUptime = (ms: number | null) =>
  ms === null ? "—" : `${Math.floor(ms / 60000)}m`;

export function WorkersTable({
  workers,
}: {
  workers: QueueStatusResponse["workers"];
}) {
  if (workers.length === 0) {
    return <p className="text-sm text-muted-foreground">No active workers.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th className="py-1">Host</th>
          <th>PID</th>
          <th>Uptime</th>
          <th>Workers</th>
          <th>Health</th>
        </tr>
      </thead>
      <tbody>
        {workers.map((w) => (
          <tr key={w.instanceId} className="border-t">
            <td className="py-1 font-mono">{w.hostname}</td>
            <td>{w.pid}</td>
            <td>{fmtUptime(w.uptimeMs)}</td>
            <td>{w.workerCount}</td>
            <td>
              <Badge variant={w.stale ? "destructive" : "secondary"}>
                {w.stale ? "stale" : "healthy"}
              </Badge>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
