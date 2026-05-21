"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  PerJobTranslationEntry,
  PublishJobResult,
  PublishStage,
} from "@/types/publish-job-result";

interface PublishProgressProps {
  publishResult: PublishJobResult | undefined;
  // Called when the author clicks "Retry failed translations" in the
  // terminal-with-failures state. Owner runs the retry via the new
  // endpoint and re-subscribes the SSE stream to the retry job; this
  // component only fires the callback.
  onRetryFailedTranslations?: () => void;
  // Disables the retry button while a publish or retry is in flight,
  // so the author can't fire it twice mid-stream.
  retryInFlight?: boolean;
}

const TERMINAL_STATUSES: ReadonlySet<PerJobTranslationEntry["status"]> =
  new Set(["completed", "failed"]);

// Lifecycle ranks for entry status. A status can only advance, never
// regress: pending → in_progress → completed/failed.
const STATUS_RANK: Record<PerJobTranslationEntry["status"], number> = {
  pending: 0,
  in_progress: 1,
  completed: 2,
  failed: 2,
};

function entryKey(entry: PerJobTranslationEntry): string {
  return `${entry.kind}:${entry.id}`;
}

// The SSE channel can deliver out-of-order snapshots when concurrent
// writers race on the job's `result` field (worker progress updates can
// preserve and re-write an older snapshot after the poll loop pushed a
// fresher one). Merge incoming entries into a sticky, monotonic local
// view so a row never regresses: `languagesCompleted` only grows, status
// only advances along the lifecycle, and a terminal status is locked.
function mergeEntry(
  prev: PerJobTranslationEntry | undefined,
  next: PerJobTranslationEntry,
): PerJobTranslationEntry {
  if (!prev) return next;
  if (TERMINAL_STATUSES.has(prev.status)) return prev;
  const winningStatus =
    STATUS_RANK[next.status] >= STATUS_RANK[prev.status]
      ? next.status
      : prev.status;
  return {
    ...next,
    status: winningStatus,
    languagesCompleted: Math.max(
      prev.languagesCompleted,
      next.languagesCompleted,
    ),
  };
}

const dotColorClass: Record<PerJobTranslationEntry["status"], string> = {
  pending: "bg-gray-300",
  in_progress: "bg-violet-600 animate-pulse",
  completed: "bg-green-600",
  failed: "bg-red-600",
};

function StatusDot({ status }: { status: PerJobTranslationEntry["status"] }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block h-2 w-2 rounded-full flex-shrink-0",
        dotColorClass[status],
      )}
    />
  );
}

function kindLabel(kind: PerJobTranslationEntry["kind"], id: number): string {
  if (kind === "question") return `Question ${id}`;
  if (kind === "variant") return `Variant ${id}`;
  return "Assignment metadata";
}

function statusLabel(
  status: PerJobTranslationEntry["status"],
  c: number,
  t: number,
): string {
  if (status === "pending") return "Queued";
  if (status === "in_progress") return `Translating · ${c}/${t} languages`;
  if (status === "completed") return "Done";
  return "Failed";
}

const kindOrder: Record<PerJobTranslationEntry["kind"], number> = {
  question: 0,
  variant: 1,
  meta: 2,
};

function sortEntries(
  entries: PerJobTranslationEntry[],
): PerJobTranslationEntry[] {
  // Stable order across poll ticks — never sort by status (that would shuffle on every tick).
  return [...entries].sort((a, b) => {
    const ko = kindOrder[a.kind] - kindOrder[b.kind];
    return ko !== 0 ? ko : a.id - b.id;
  });
}

export default function PublishProgress({
  publishResult,
  onRetryFailedTranslations,
  retryInFlight,
}: PublishProgressProps) {
  // Sticky merged view of perJob entries. The parent passes a `key`
  // that changes per publish, so this component fully remounts at the
  // start of every publish — the ref is naturally fresh, no manual
  // reset needed. The same key-remount also resets `dismissed` for
  // free: a new publish/retry always shows the card again.
  const mergedMapRef = React.useRef<Map<string, PerJobTranslationEntry>>(
    new Map(),
  );
  const [dismissed, setDismissed] = React.useState(false);

  if (!publishResult?.stage || dismissed) return null;

  const incomingPerJob = publishResult.translations?.perJob;
  const map = mergedMapRef.current;
  for (const entry of incomingPerJob ?? []) {
    const key = entryKey(entry);
    map.set(key, mergeEntry(map.get(key), entry));
  }
  const perJob = sortEntries(Array.from(map.values()));

  // Stay hidden when the publish carries no actual translation work — e.g.
  // server-side translation is disabled, or this was a metadata-only
  // republish where no jobs were enqueued. The wire-level aggregate is the
  // source of truth (server-emitted on the "no work" short-circuit).
  const wireAggregate = publishResult.translations?.aggregate;
  if (
    perJob.length === 0 &&
    wireAggregate !== undefined &&
    wireAggregate.total === 0
  ) {
    return null;
  }

  const allTerminal =
    perJob.length > 0 && perJob.every((e) => TERMINAL_STATUSES.has(e.status));
  // Derived stage promotes the row to "translations_complete" as soon as
  // every merged entry is terminal, even if a stale wire snapshot still
  // says translations_in_progress. Falls back to the wire stage when no
  // entries have arrived yet (db_writes_done before the first poll tick).
  const stage: PublishStage = allTerminal
    ? "translations_complete"
    : perJob.length === 0
      ? publishResult.stage
      : "translations_in_progress";

  const aggregate =
    perJob.length > 0
      ? {
          completed: perJob.filter((e) => e.status === "completed").length,
          failed: perJob.filter((e) => e.status === "failed").length,
          total: perJob.length,
        }
      : publishResult.translations?.aggregate;

  const heading =
    stage === "db_writes_done"
      ? "Publishing complete — translating in background"
      : stage === "translations_in_progress"
        ? "Translating questions"
        : aggregate && aggregate.failed > 0
          ? `Translations finished with ${aggregate.failed} failure(s)`
          : "All translations complete";

  const body =
    stage === "db_writes_done"
      ? "Your assignment is published and learners can attempt it now. Translations across 23 languages are still running and will appear automatically as they finish. You can leave this page; closing the tab will not stop the translations."
      : stage === "translations_complete" && aggregate && aggregate.failed === 0
        ? "Every question is now available in all 23 languages."
        : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="mt-4"
    >
      <Card className="bg-white border-border">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h3 key={heading} translate="no" className="typography-h5">
                {heading}
              </h3>
              {body && (
                <p translate="no" className="text-sm text-muted-foreground">
                  {body}
                </p>
              )}
            </div>
            {stage === "translations_complete" && (
              <button
                type="button"
                onClick={() => setDismissed(true)}
                aria-label="Dismiss"
                className="flex-shrink-0 -mt-1 -mr-1 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-600 focus:ring-offset-2"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>

          {stage === "translations_in_progress" && aggregate && (
            <div className="flex items-center gap-3 px-3 py-2 rounded-md bg-muted">
              <Badge className="bg-violet-600 text-white border-transparent hover:bg-violet-600">
                Translating
              </Badge>
              <span
                key={`agg-text-${aggregate.completed}-${aggregate.total}`}
                translate="no"
                className="text-sm font-medium"
              >
                {aggregate.completed} of {aggregate.total} translations complete
              </span>
              {aggregate.failed > 0 && (
                <span
                  key={`agg-failed-${aggregate.failed}`}
                  translate="no"
                  className="text-sm font-medium text-red-700"
                >
                  · {aggregate.failed} failed
                </span>
              )}
            </div>
          )}

          {perJob.length > 0 && (
            <ul role="list" className="space-y-2 max-h-96 overflow-y-auto">
              {perJob.map((entry) => {
                const kLabel = kindLabel(entry.kind, entry.id);
                const sLabel = statusLabel(
                  entry.status,
                  entry.languagesCompleted,
                  entry.languagesTotal,
                );
                return (
                  <li
                    key={`${entry.kind}:${entry.id}`}
                    className="flex items-center gap-3 px-3 py-2 rounded-md bg-gray-50 border border-gray-200"
                  >
                    <StatusDot status={entry.status} />
                    <span
                      key={kLabel}
                      translate="no"
                      className="typography-body flex-1"
                    >
                      {kLabel}
                    </span>
                    <span
                      key={sLabel}
                      translate="no"
                      className="typography-caption text-muted-foreground"
                    >
                      {sLabel}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {stage === "translations_complete" &&
            aggregate &&
            aggregate.failed > 0 && (
              <Alert variant="destructive">
                <AlertTitle>
                  Translations finished with {aggregate.failed} failure(s)
                </AlertTitle>
                <AlertDescription className="space-y-3">
                  <p translate="no">
                    {aggregate.failed === 1
                      ? `One question could not be translated. Learners attempting that question in an affected language will see a "translation unavailable" notice and the original English text.`
                      : `${aggregate.failed} questions could not be translated. Learners attempting those questions in affected languages will see a "translation unavailable" notice and the original English text.`}
                  </p>
                  {onRetryFailedTranslations && (
                    <button
                      type="button"
                      onClick={onRetryFailedTranslations}
                      disabled={retryInFlight}
                      translate="no"
                      className="text-sm font-medium px-4 py-2 border border-solid rounded-md shadow-sm focus:ring-offset-2 focus:ring-violet-600 focus:ring-2 focus:outline-none transition-all text-white border-violet-600 bg-violet-600 hover:bg-violet-800 hover:border-violet-800 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Retry failed translations
                    </button>
                  )}
                </AlertDescription>
              </Alert>
            )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
