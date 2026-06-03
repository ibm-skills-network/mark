"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { QueueStatusResponse } from "@/lib/shared";

type Queue = QueueStatusResponse["queues"][number];

export function QueueCard({
  queue,
  onInspectFailed,
}: {
  queue: Queue;
  onInspectFailed: (queueName: string) => void;
}) {
  const cells: Array<[string, number]> = [
    ["waiting", queue.waiting],
    ["active", queue.active],
    ["delayed", queue.delayed],
    ["completed", queue.completed],
    ["paused", queue.paused],
  ];
  return (
    <Card className={queue.unavailable ? "opacity-60" : ""}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-mono">{queue.name}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-2 text-sm">
        {cells.map(([label, value]) => (
          <div key={label}>
            <div className="text-muted-foreground text-xs">{label}</div>
            <div className="font-semibold">{value}</div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onInspectFailed(queue.name)}
          className="text-left cursor-pointer rounded hover:bg-muted/50"
        >
          <div className="text-muted-foreground text-xs">failed</div>
          <div
            className={`font-semibold ${
              queue.failed > 0 ? "text-red-600 underline" : ""
            }`}
          >
            {queue.failed}
          </div>
        </button>
        {queue.unavailable ? (
          <div className="col-span-3 text-xs text-amber-600">unavailable</div>
        ) : null}
      </CardContent>
    </Card>
  );
}
