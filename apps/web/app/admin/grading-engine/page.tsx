"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiClient } from "@/lib/api-client";
import { isAdminAuthError } from "@/lib/shared";
import {
  buildAdminLoginRedirect,
  clearAdminSessionStorage,
  readAdminSessionFromStorage,
} from "@/lib/admin-session";

const ENDPOINT = "/api/v3/grading-settings/engine";

type Target = "v3" | "legacy";

interface EngineSetting {
  engine: Target | "mixed";
  assignmentOverrides: number;
  updatedBy: string | null;
  updatedAt: string | null;
}

const ENGINE_LABEL: Record<EngineSetting["engine"], string> = {
  v3: "v3",
  legacy: "Legacy",
  mixed: "Mixed",
};

export default function GradingEnginePage() {
  const router = useRouter();
  const [setting, setSetting] = useState<EngineSetting | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectToLogin = () => {
    clearAdminSessionStorage();
    router.replace(buildAdminLoginRedirect(window.location.pathname));
  };

  const adminHeaders = () => {
    const stored = readAdminSessionFromStorage();
    return stored ? { "x-admin-token": stored.sessionToken } : null;
  };

  useEffect(() => {
    const headers = adminHeaders();
    if (!headers) {
      redirectToLogin();
      return;
    }
    apiClient
      .get<EngineSetting>(ENDPOINT, { headers })
      .then(setSetting)
      .catch((err: unknown) => {
        if (isAdminAuthError(err)) {
          redirectToLogin();
          return;
        }
        setError("Could not load the grading engine.");
      });
  }, []);

  const confirm = async () => {
    const headers = adminHeaders();
    if (!headers) {
      redirectToLogin();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      setSetting(
        await apiClient.put<EngineSetting>(
          ENDPOINT,
          { engine: target },
          { headers },
        ),
      );
    } catch (err) {
      if (isAdminAuthError(err)) {
        redirectToLogin();
        return;
      }
      setError("Could not switch the grading engine. Nothing was changed.");
    } finally {
      setSaving(false);
      setTarget(null);
    }
  };

  const overrides = setting?.assignmentOverrides ?? 0;

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8 space-y-6">
      <Link href="/admin">
        <Button variant="ghost" size="sm">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to dashboard
        </Button>
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>Grading engine</CardTitle>
          <p className="text-sm text-gray-600">
            The engine for text, upload, link and URL questions, for every
            assignment without its own setting. Other questions are not
            affected.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {setting && (
            <>
              <p className="text-lg font-medium">
                Current engine: {ENGINE_LABEL[setting.engine]}
              </p>
              {setting.engine === "mixed" && (
                <p className="text-sm text-gray-600">
                  Question types are on different engines. Switching moves them
                  all to one.
                </p>
              )}

              <div className="flex items-center justify-between gap-4">
                <p className="text-xs text-gray-500">
                  {setting.updatedBy
                    ? `Last changed by ${setting.updatedBy}${
                        setting.updatedAt
                          ? ` on ${new Date(setting.updatedAt).toLocaleString()}`
                          : ""
                      }`
                    : "Never saved."}
                </p>
                <div className="flex gap-2">
                  {setting.engine !== "legacy" && (
                    <Button
                      variant="destructive"
                      onClick={() => setTarget("legacy")}
                    >
                      Switch to legacy
                    </Button>
                  )}
                  {setting.engine !== "v3" && (
                    <Button onClick={() => setTarget("v3")}>
                      Switch to v3
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {target === "legacy"
                ? "Switch all grading to legacy?"
                : "Switch all grading to v3?"}
            </DialogTitle>
            <DialogDescription>
              New grades move within 30 seconds. Grading already in progress
              finishes on the engine it started on.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            {target === "legacy" && (
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  Legacy is no longer maintained. It gets no new fixes, and v3
                  features such as the effort boost do not apply.
                </li>
                <li>Legacy has cost about twice as much as v3 to run.</li>
              </ul>
            )}
            {overrides > 0 && (
              <p>
                {overrides === 1
                  ? "1 assignment has its own setting and will not change."
                  : `${overrides} assignments have their own settings and will not change.`}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => setTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant={target === "legacy" ? "destructive" : "default"}
              disabled={saving}
              onClick={() => void confirm()}
            >
              {saving
                ? "Switching…"
                : target === "legacy"
                  ? "Yes, switch to legacy"
                  : "Yes, switch to v3"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
