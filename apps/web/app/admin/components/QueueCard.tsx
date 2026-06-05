"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { QueueHistorySample } from "@/hooks/useQueueStatus";
import type { QueueRole, QueueStat } from "@/lib/shared";
import { Sparkline } from "./Sparkline";

const ROLE_LABEL: Record<QueueRole, string> = {
  author: "author",
  learner: "learner",
  translation: "translation",
  "admin-maintenance": "admin maint.",
};

function formatMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

export function QueueCard({
  queue,
  history,
  onInspectFailed,
  onInspectActive,
}: {
  queue: QueueStat;
  history?: QueueHistorySample[];
  onInspectFailed: (queueName: string) => void;
  onInspectActive: (queueName: string) => void;
}) {
  const { throughput } = queue;
  const failedSeries = (history ?? []).map((sample) => sample.failed);
  const activeSeries = (history ?? []).map((sample) => sample.active);

  return (
    <Card className={queue.unavailable ? "opacity-60" : ""}>
      <CardHeader className="pb-2 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-mono">{queue.name}</CardTitle>
          <div className="flex items-center gap-1">
            {queue.role ? (
              <Badge variant="outline" className="text-[10px]">
                {ROLE_LABEL[queue.role]}
              </Badge>
            ) : null}
            {queue.isPaused ? (
              <Badge variant="secondary" className="text-[10px]">
                paused
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          {queue.concurrencyPerPod} × {queue.livePods} pod
          {queue.livePods === 1 ? "" : "s"} ={" "}
          <span className="font-semibold text-foreground">
            {queue.clusterCapacity}
          </span>{" "}
          capacity
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="grid grid-cols-3 gap-2">
          <div>
            <div className="text-muted-foreground text-xs">waiting</div>
            <div className="font-semibold">{queue.waiting}</div>
          </div>
          <button
            type="button"
            onClick={() => onInspectActive(queue.name)}
            className="text-left cursor-pointer rounded hover:bg-muted/50"
          >
            <div className="text-muted-foreground text-xs">active</div>
            <div
              className={`font-semibold ${
                queue.active > 0 ? "text-blue-600 underline" : ""
              }`}
            >
              {queue.active}
            </div>
          </button>
          <div>
            <div className="text-muted-foreground text-xs">delayed</div>
            <div className="font-semibold">{queue.delayed}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">completed</div>
            <div className="font-semibold">{queue.completed}</div>
          </div>
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
          <div>
            <div className="text-muted-foreground text-xs">paused</div>
            <div className="font-semibold">{queue.paused}</div>
          </div>
        </div>

        {throughput ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground border-t pt-2">
            <span className="text-green-600 font-medium">
              ✓ {throughput.completedPerMin}/min
            </span>
            <span className="text-red-600 font-medium">
              ✗ {throughput.failedPerMin}/min
            </span>
            <span>wait {formatMs(throughput.avgWaitMs)}</span>
            <span>run {formatMs(throughput.avgRunMs)}</span>
          </div>
        ) : null}

        {(history?.length ?? 0) > 1 ? (
          <div className="flex items-center gap-3 border-t pt-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-muted-foreground">active</span>
              <Sparkline
                values={activeSeries}
                strokeClassName="stroke-blue-500"
                label={`active history for ${queue.name}`}
              />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-muted-foreground">failed</span>
              <Sparkline
                values={failedSeries}
                strokeClassName="stroke-red-500"
                label={`failed history for ${queue.name}`}
              />
            </div>
          </div>
        ) : null}

        {queue.unavailable ? (
          <div className="text-xs text-amber-600 border-t pt-2">
            unavailable
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
