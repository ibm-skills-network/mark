"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  type AiFeatureFlagState,
  getAiFeatureFlags,
  setAiFeatureFlag,
} from "@/lib/shared";

const COMPONENT_LABELS: Record<AiFeatureFlagState["component"], string> = {
  ALL: "All AI (master switch)",
  GRADING: "AI grading",
  CHAT: "AI chatbot",
  AUTHORING: "Author AI (translation & generation)",
};

const ORDER: AiFeatureFlagState["component"][] = [
  "ALL",
  "GRADING",
  "CHAT",
  "AUTHORING",
];

interface PendingChange {
  component: AiFeatureFlagState["component"];
  /** Desired state after the toggle. */
  enabled: boolean;
}

/** Three sequential confirmations before an AI component is toggled. */
function confirmCopy(
  pending: PendingChange,
): { title: string; body: string }[] {
  const label = COMPONENT_LABELS[pending.component];
  const verb = pending.enabled ? "ENABLE" : "DISABLE";
  const masterNote =
    pending.component === "ALL"
      ? pending.enabled
        ? " This re-enables every AI component that isn't individually disabled."
        : " This disables grading, chat, and authoring AI all at once."
      : "";
  const spendNote = pending.enabled
    ? " If the provider account is still unavailable this may resume failing/charged calls."
    : " Deterministic MCQ / True-False / Multi-Select grading is unaffected.";
  return [
    {
      title: `Step 1 of 3 — ${verb} ${label}?`,
      body: `You are about to ${verb.toLowerCase()} ${label}.${masterNote}`,
    },
    {
      title: `Step 2 of 3 — confirm impact`,
      body: `This applies to every user in this environment and takes effect within ~10 seconds across all pods.${spendNote}`,
    },
    {
      title: `Step 3 of 3 — final confirmation`,
      body: `Final check: ${verb} ${label} now?`,
    },
  ];
}

export function AiFeatureControls({
  sessionToken,
}: {
  sessionToken?: string | null;
}) {
  const [flags, setFlags] = useState<AiFeatureFlagState[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!sessionToken) return;
    try {
      setFlags(await getAiFeatureFlags(sessionToken));
      setError(null);
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "Failed to load");
    }
  }, [sessionToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const cancel = () => {
    setPending(null);
    setStep(0);
  };

  const advance = async () => {
    if (!pending || !sessionToken) return;
    if (step < 3) {
      setStep(step + 1);
      return;
    }
    setSubmitting(true);
    try {
      const updated = await setAiFeatureFlag(
        sessionToken,
        pending.component,
        pending.enabled,
      );
      setFlags(updated);
      setError(null);
      cancel();
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "Failed to update");
    } finally {
      setSubmitting(false);
    }
  };

  if (!sessionToken) return null;

  const ordered = ORDER.map((component) =>
    flags?.find((f) => f.component === component),
  ).filter(Boolean);

  const steps = pending ? confirmCopy(pending) : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          AI kill-switch
          <span className="text-xs font-normal text-muted-foreground">
            disable AI features without a redeploy
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}
        {flags === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          ordered.map((flag) => {
            const offByMaster =
              flag.component !== "ALL" && flag.disabled && flag.enabled;
            return (
              <div
                key={flag.component}
                className="flex items-center justify-between gap-3 border-b py-2 last:border-b-0"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {COMPONENT_LABELS[flag.component]}
                  </span>
                  {flag.disabled ? (
                    <Badge variant="destructive">
                      {offByMaster ? "Off (master)" : "Disabled"}
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Enabled</Badge>
                  )}
                  {flag.updatedBy ? (
                    <span className="text-xs text-muted-foreground">
                      last changed by {flag.updatedBy}
                    </span>
                  ) : null}
                </div>
                <Button
                  size="sm"
                  variant={flag.enabled ? "destructive" : "outline"}
                  onClick={() => {
                    setPending({
                      component: flag.component,
                      enabled: !flag.enabled,
                    });
                    setStep(1);
                  }}
                >
                  {flag.enabled ? "Disable" : "Enable"}
                </Button>
              </div>
            );
          })
        )}
      </CardContent>

      <Dialog open={step > 0} onOpenChange={(open) => (open ? null : cancel())}>
        <DialogContent>
          {pending ? (
            <>
              <DialogHeader>
                <DialogTitle>{steps[step - 1]?.title}</DialogTitle>
                <DialogDescription>{steps[step - 1]?.body}</DialogDescription>
              </DialogHeader>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={cancel}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button
                  variant={pending.enabled ? "default" : "destructive"}
                  onClick={() => void advance()}
                  disabled={submitting}
                >
                  {step < 3
                    ? "Continue"
                    : submitting
                      ? "Applying…"
                      : pending.enabled
                        ? "Enable now"
                        : "Disable now"}
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
