"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  PerJobTranslationEntry,
  PublishJobResult,
} from "@/types/publish-job-result";

interface PublishProgressProps {
  publishResult: PublishJobResult | undefined;
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
}: PublishProgressProps) {
  if (!publishResult?.stage) return null;

  const { stage, translations } = publishResult;
  const aggregate = translations?.aggregate;
  const perJob = sortEntries(translations?.perJob ?? []);

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
              <h3 className="typography-h5">{heading}</h3>
              {body && <p className="text-sm text-muted-foreground">{body}</p>}
            </div>
          </div>

          {stage === "translations_in_progress" && aggregate && (
            <div className="flex items-center gap-3 px-3 py-2 rounded-md bg-muted">
              <Badge className="bg-violet-600 text-white border-transparent hover:bg-violet-600">
                Translating
              </Badge>
              <span className="text-sm font-medium">
                {aggregate.completed} of {aggregate.total} translations complete
              </span>
              {aggregate.failed > 0 && (
                <span className="text-sm font-medium text-red-700">
                  · {aggregate.failed} failed
                </span>
              )}
            </div>
          )}

          {perJob.length > 0 && (
            <ul role="list" className="space-y-2 max-h-96 overflow-y-auto">
              {perJob.map((entry) => (
                <li
                  key={`${entry.kind}:${entry.id}`}
                  className="flex items-center gap-3 px-3 py-2 rounded-md bg-gray-50 border border-gray-200"
                >
                  <StatusDot status={entry.status} />
                  <span className="typography-body flex-1">
                    {kindLabel(entry.kind, entry.id)}
                  </span>
                  <span className="typography-caption text-muted-foreground">
                    {statusLabel(
                      entry.status,
                      entry.languagesCompleted,
                      entry.languagesTotal,
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {stage === "translations_complete" &&
            aggregate &&
            aggregate.failed > 0 && (
              <Alert variant="destructive">
                <AlertTitle>
                  Translations finished with {aggregate.failed} failure(s)
                </AlertTitle>
                <AlertDescription>
                  {aggregate.failed === 1
                    ? `One question could not be translated. Learners attempting that question in an affected language will see a "translation unavailable" notice and the original English text. An admin can re-run missing translations from the admin tools.`
                    : `${aggregate.failed} questions could not be translated. Learners attempting those questions in affected languages will see a "translation unavailable" notice and the original English text. An admin can re-run missing translations from the admin tools.`}
                </AlertDescription>
              </Alert>
            )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
