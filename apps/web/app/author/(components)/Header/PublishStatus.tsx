"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
} from "@heroicons/react/24/solid";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type {
  PerJobTranslationEntry,
  PublishJobResult,
} from "@/types/publish-job-result";
import type { JobStatus } from "@/components/ProgressBar";

// Phase split for the unified bar. DB writes own the first PHASE_1_CEILING
// percent; translation fan-out owns the remainder. 30/70 means the bar
// visibly pauses around 30% for the brief window between db_writes_done
// and the first translation poll tick — acceptable trade for keeping the
// bar moving forward through the whole publish.
const PHASE_1_CEILING = 30;

interface PublishStatusProps {
  // True while the publish job is in flight on the server side. Lets us
  // render the empty/early state before any SSE result has arrived.
  submitting: boolean;
  // Server-reported job percentage (0–100). Drives phase 1 bar fill.
  jobProgress: number;
  // Job lifecycle. "Failed" flips bar to red + heading to "Publishing failed".
  progressStatus: JobStatus;
  publishResult: PublishJobResult | undefined;
  onRetryFailedTranslations?: () => void;
  retryInFlight?: boolean;
}

// Window after a clean-success terminal state before the card auto-hides.
// Long enough for the eye to register "Published" + the green check, short
// enough to get out of the author's way. Failure / partial-failure stays
// sticky so the retry button remains reachable.
const AUTO_DISMISS_MS = 3000;

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
// writers race on the job's `result` field. Merge incoming entries into a
// sticky, monotonic local view so a row never regresses: `languagesCompleted`
// only grows, status only advances along the lifecycle, and a terminal
// status is locked.
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

export default function PublishStatus({
  submitting,
  jobProgress,
  progressStatus,
  publishResult,
  onRetryFailedTranslations,
  retryInFlight,
}: PublishStatusProps) {
  // Sticky merged view of perJob entries. The parent passes a `key`
  // that changes per publish, so this component fully remounts at the
  // start of every publish — the ref is naturally fresh.
  const mergedMapRef = React.useRef<Map<string, PerJobTranslationEntry>>(
    new Map(),
  );
  // Monotonic ratchet for the visible bar. Server-side phase 1 progress
  // ticks aren't strictly monotonic — different SSE-emitting code paths
  // (publish poller vs question-service intermediate updates) report
  // their own percentages, so a 27% tick can land after a 14% tick and
  // make the bar visibly jitter backwards. Holding the max keeps the bar
  // moving forward only. The parent passes a per-publish `key` that
  // remounts the component, which naturally resets this ref to 0 on
  // every new publish — no manual cleanup needed.
  const maxPercentageRef = React.useRef<number>(0);
  const [dismissed, setDismissed] = React.useState(false);
  const [detailsOpen, setDetailsOpen] = React.useState(false);

  // Merge incoming per-job entries before any early return so the sticky
  // ref keeps tracking even when the component would have otherwise hidden.
  const incomingPerJob = publishResult?.translations?.perJob;
  const map = mergedMapRef.current;
  for (const entry of incomingPerJob ?? []) {
    const key = entryKey(entry);
    map.set(key, mergeEntry(map.get(key), entry));
  }
  const perJob = sortEntries(Array.from(map.values()));

  // User-facing counts only show question (and variant) translation jobs.
  // Assignment metadata is one bundled job that authors don't think of as
  // a "question"; rolling it into the X/Y count makes Y look one too high
  // (e.g. "8 of 8 questions" when the author wrote 7 + 1 meta). Meta is
  // still visible in the details drawer with its own label, so authors
  // can find it if they expand details.
  const visibleEntries = perJob.filter((e) => e.kind !== "meta");
  const hasOnlyMetaWork =
    perJob.length > 0 && visibleEntries.length === 0;

  // Compose the wire-level aggregate with whatever has been merged locally —
  // visibleEntries takes precedence once any non-meta entries have arrived
  // (the ratcheted, meta-filtered view), otherwise we fall back to the
  // server's aggregate (which carries totals during the no-perJob-yet
  // window, briefly including meta in the count until perJob arrives).
  const wireAggregate = publishResult?.translations?.aggregate;
  const aggregate =
    visibleEntries.length > 0
      ? {
          completed: visibleEntries.filter((e) => e.status === "completed")
            .length,
          failed: visibleEntries.filter((e) => e.status === "failed").length,
          total: visibleEntries.length,
        }
      : wireAggregate;

  // Phase classification. Three states matching the heading trio.
  const isFailureMode = progressStatus === "Failed";
  const allTerminal =
    perJob.length > 0 && perJob.every((e) => TERMINAL_STATUSES.has(e.status));
  const isTerminal =
    isFailureMode ||
    allTerminal ||
    publishResult?.stage === "translations_complete";
  const hasTranslationPhase =
    !isTerminal &&
    (publishResult?.stage === "translations_in_progress" ||
      perJob.length > 0 ||
      publishResult?.stage === "db_writes_done");

  // Clean-success auto-dismiss. Partial failure or full failure stays
  // sticky: the retry button (partial) or the failure copy (full) must
  // remain visible so the author can act on it. The effect must run
  // before any early returns to keep hook ordering stable across renders.
  const shouldAutoDismiss =
    isTerminal && !isFailureMode && (aggregate?.failed ?? 0) === 0;
  React.useEffect(() => {
    if (!shouldAutoDismiss) return;
    const t = setTimeout(() => setDismissed(true), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [shouldAutoDismiss]);

  // Auto-hide on no-work terminal state (translation disabled, or
  // metadata-only republish). The server emits aggregate.total=0 on the
  // short-circuit path; PublishProgress had the same guard.
  if (
    isTerminal &&
    !isFailureMode &&
    perJob.length === 0 &&
    wireAggregate !== undefined &&
    wireAggregate.total === 0
  ) {
    return null;
  }

  // Don't render until something is actually in flight or has arrived.
  if (!submitting && !publishResult?.stage) return null;
  if (dismissed) return null;

  // Unified percentage across both phases. Computed each render from the
  // current SSE state, then clamped to a monotonic max via the ratchet
  // ref below so the visible bar never reverses.
  let rawPercentage: number;
  if (isTerminal) {
    rawPercentage = isFailureMode ? Math.min(jobProgress, 100) : 100;
  } else if (hasTranslationPhase) {
    const total = aggregate?.total ?? 0;
    const completed = aggregate?.completed ?? 0;
    const fraction = total > 0 ? Math.min(1, completed / total) : 0;
    rawPercentage = PHASE_1_CEILING + fraction * (100 - PHASE_1_CEILING);
  } else {
    // Phase 1 (Publishing): linear with jobProgress, capped at PHASE_1_CEILING.
    rawPercentage = (Math.min(jobProgress, 100) / 100) * PHASE_1_CEILING;
  }
  if (rawPercentage > maxPercentageRef.current) {
    maxPercentageRef.current = rawPercentage;
  }
  const unifiedPercentage = maxPercentageRef.current;

  // Heading trio per design. Failure case is a 4th leaf only because the
  // visual treatment (red bar, X icon) demands matching copy.
  const heading = isFailureMode
    ? "Publishing failed"
    : isTerminal
      ? "Published"
      : hasTranslationPhase
        ? "Translating"
        : "Publishing assignment";

  // Subtext follows the same phase split. The hasOnlyMetaWork checks
  // come BEFORE the aggregate.total > 0 branch because the fallback
  // wireAggregate still carries total=1 in the meta-only case, which
  // would otherwise misroute into the "0 of 1 questions" copy.
  //
  // Phase-1 / failure no longer surfaces the cycling SSE progress text
  // (e.g. "Translating Question #6346: Қазақ тілі - Checking for existing
  // translation"). Per-language fan-out is parallel now, so a single
  // serialized message implies progression the system isn't actually
  // making, and the bar + aggregate + details drawer already convey
  // everything the author needs.
  const subtext = isFailureMode
    ? "Publish encountered an error."
    : isTerminal
      ? aggregate && (aggregate.failed ?? 0) > 0
        ? `Translations finished with ${aggregate.failed} failure(s)`
        : hasOnlyMetaWork
          ? "Assignment metadata translated"
          : aggregate && aggregate.total > 0
            ? "All translations complete"
            : ""
      : hasTranslationPhase
        ? hasOnlyMetaWork
          ? "Translating assignment metadata"
          : aggregate && aggregate.total > 0
            ? `${aggregate.completed} of ${aggregate.total} questions complete${
                (aggregate.failed ?? 0) > 0
                  ? ` — ${aggregate.failed} failed`
                  : ""
              }`
            : "Preparing translations..."
        : "Saving changes...";

  // Terminal-with-partial-failures gets the amber treatment so a green bar
  // doesn't visually disagree with "Translations finished with N failure(s)".
  // Full failure (the publish itself blew up) stays red, clean success
  // stays green, in-flight stays violet.
  const hasPartialFailure =
    isTerminal && !isFailureMode && (aggregate?.failed ?? 0) > 0;
  const barColor = isFailureMode
    ? "bg-gradient-to-r from-red-400 to-red-600"
    : hasPartialFailure
      ? "bg-gradient-to-r from-amber-400 to-amber-600"
      : isTerminal
        ? "bg-gradient-to-r from-green-400 to-green-600"
        : "bg-gradient-to-r from-violet-400 to-violet-600";

  const showRetry =
    isTerminal && !isFailureMode && (aggregate?.failed ?? 0) > 0;

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
            <h3 key={heading} translate="no" className="typography-h5">
              {heading}
            </h3>
            {isTerminal && (
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

          {/* Unified progress bar — fills smoothly across both phases. */}
          <div className="relative">
            <div className="h-3 rounded-full bg-gray-200 overflow-hidden">
              <motion.div
                className={cn("h-full rounded-full shadow-md", barColor)}
                initial={{ width: 0 }}
                animate={{ width: `${Math.round(unifiedPercentage)}%` }}
                transition={{ type: "spring", stiffness: 120, damping: 20 }}
              />
            </div>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="text-white font-bold text-xs flex items-center">
                {Math.round(unifiedPercentage)}%
                {isTerminal && !isFailureMode && !hasPartialFailure && (
                  <CheckCircleIcon
                    className="w-4 h-4 ml-1 text-green-700"
                    aria-hidden="true"
                  />
                )}
                {hasPartialFailure && (
                  <ExclamationTriangleIcon
                    className="w-4 h-4 ml-1 text-amber-700"
                    aria-hidden="true"
                  />
                )}
                {isFailureMode && (
                  <XCircleIcon
                    className="w-4 h-4 ml-1 text-red-700"
                    aria-hidden="true"
                  />
                )}
              </span>
            </div>
          </div>

          {subtext && (
            <div className="relative h-5 sm:h-6 overflow-hidden">
              <AnimatePresence mode="wait">
                <motion.p
                  key={subtext}
                  initial={{ y: 8, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -8, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  translate="no"
                  className="absolute inset-x-0 text-center text-sm text-muted-foreground"
                >
                  {subtext}
                </motion.p>
              </AnimatePresence>
            </div>
          )}

          {showRetry && onRetryFailedTranslations && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onRetryFailedTranslations}
                disabled={retryInFlight}
                translate="no"
                className="text-sm font-medium px-4 py-2 border border-solid rounded-md shadow-sm focus:ring-offset-2 focus:ring-violet-600 focus:ring-2 focus:outline-none transition-all text-white border-violet-600 bg-violet-600 hover:bg-violet-800 hover:border-violet-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Retry failed translations
              </button>
            </div>
          )}

          {perJob.length > 0 && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setDetailsOpen((open) => !open)}
                aria-expanded={detailsOpen}
                className="text-sm text-violet-600 hover:text-violet-800 flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-violet-600 focus:ring-offset-2 rounded-md px-1"
              >
                {detailsOpen ? (
                  <ChevronUp className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                )}
                {detailsOpen ? "Hide details" : "Show details"}
              </button>
              <AnimatePresence initial={false}>
                {detailsOpen && (
                  <motion.ul
                    role="list"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-2 mt-3 max-h-96 overflow-y-auto overflow-x-hidden"
                  >
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
                            translate="no"
                            className="typography-body flex-1"
                          >
                            {kLabel}
                          </span>
                          {/* key={sLabel} forces a full DOM remount when the
                              status text changes. Firefox's built-in page
                              translation latches onto text nodes after first
                              render and stops applying React's text updates
                              (visible as a "100% / All translations complete"
                              header with stale "Translating · 15/23 languages"
                              rows); remounting on text change breaks that
                              latch. translate="no" alone is not reliable when
                              translate-from-English is forced on at the browser
                              level. */}
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
                  </motion.ul>
                )}
              </AnimatePresence>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
