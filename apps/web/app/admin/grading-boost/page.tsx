"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CheckCircle, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient } from "@/lib/api-client";
import { isAdminAuthError } from "@/lib/shared";
import {
  buildAdminLoginRedirect,
  clearAdminSessionStorage,
  readAdminSessionFromStorage,
} from "@/lib/admin-session";

const ENDPOINT = "/api/v3/grading-settings/boost";
const PREVIEW_SIZES = [1, 2, 3, 4, 6, 8, 10, 12, 20];

interface BoostSetting {
  enabled: boolean;
  pointsPerStep: number;
  maxBoost: number;
  minScorePercent: number;
  updatedBy: string | null;
  updatedAt: string | null;
}

/** Mirrors the API's bounds; the server validates again. */
function inRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/** Mirrors effortBoostPoints in the API. */
function boostFor(maxPoints: number, pointsPerStep: number, maxBoost: number) {
  return Math.min(maxBoost, Math.floor(maxPoints / pointsPerStep));
}

export default function GradingBoostPage() {
  const router = useRouter();
  const [setting, setSetting] = useState<BoostSetting | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [pointsPerStep, setPointsPerStep] = useState("4");
  const [maxBoost, setMaxBoost] = useState("3");
  const [minScorePercent, setMinScorePercent] = useState("40");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const redirectToLogin = () => {
    clearAdminSessionStorage();
    router.replace(buildAdminLoginRedirect(window.location.pathname));
  };

  const adminHeaders = () => {
    const stored = readAdminSessionFromStorage();
    return stored ? { "x-admin-token": stored.sessionToken } : null;
  };

  const show = (next: BoostSetting) => {
    setSetting(next);
    setEnabled(next.enabled);
    setPointsPerStep(String(next.pointsPerStep));
    setMaxBoost(String(next.maxBoost));
    setMinScorePercent(String(next.minScorePercent));
  };

  useEffect(() => {
    const headers = adminHeaders();
    if (!headers) {
      redirectToLogin();
      return;
    }
    apiClient
      .get<BoostSetting>(ENDPOINT, { headers })
      .then(show)
      .catch((err: unknown) => {
        if (isAdminAuthError(err)) {
          redirectToLogin();
          return;
        }
        setError("Could not load the boost setting.");
      });
  }, []);

  const step = Number(pointsPerStep);
  const cap = Number(maxBoost);
  const minScore = Number(minScorePercent);
  const valid =
    inRange(step, 1, 100) && inRange(cap, 0, 20) && inRange(minScore, 0, 100);

  const save = async () => {
    const headers = adminHeaders();
    if (!headers) {
      redirectToLogin();
      return;
    }
    setSaving(true);
    setError(null);
    setSavedAt(null);
    try {
      const next = await apiClient.put<BoostSetting>(
        ENDPOINT,
        {
          enabled,
          pointsPerStep: step,
          maxBoost: cap,
          minScorePercent: minScore,
        },
        { headers },
      );
      show(next);
      setSavedAt(next.updatedAt);
    } catch (err) {
      if (isAdminAuthError(err)) {
        redirectToLogin();
        return;
      }
      setError("Could not save the boost setting.");
    } finally {
      setSaving(false);
    }
  };

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
          <CardTitle>Effort boost</CardTitle>
          <p className="text-sm text-gray-600">
            Extra points on AI-graded questions when the grader judges the
            learner made a genuine attempt but missed criteria. Only for
            attempts at or above the minimum score, and never more than half of
            the points already earned or past the question&apos;s points.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {savedAt && (
            <Alert>
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>Saved.</AlertDescription>
            </Alert>
          )}

          {setting && (
            <>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  aria-label="Enabled"
                  onClick={() => setEnabled(!enabled)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    enabled ? "bg-violet-600" : "bg-gray-300"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                      enabled ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </button>
                <span className="text-sm font-medium">
                  {enabled ? "On" : "Off"}
                </span>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="points-per-step">
                    Question points per boost point (1–100)
                  </Label>
                  <Input
                    id="points-per-step"
                    type="number"
                    min={1}
                    max={100}
                    value={pointsPerStep}
                    onChange={(event) => setPointsPerStep(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="max-boost">
                    Most points per question (0–20)
                  </Label>
                  <Input
                    id="max-boost"
                    type="number"
                    min={0}
                    max={20}
                    value={maxBoost}
                    onChange={(event) => setMaxBoost(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="min-score">Minimum score % (0–100)</Label>
                  <Input
                    id="min-score"
                    type="number"
                    min={0}
                    max={100}
                    value={minScorePercent}
                    onChange={(event) => setMinScorePercent(event.target.value)}
                  />
                </div>
              </div>

              {valid && (
                <Table aria-label="Boost preview">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Question</TableHead>
                      <TableHead>Largest boost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {PREVIEW_SIZES.map((size) => (
                      <TableRow key={size}>
                        <TableCell>Out of {size}</TableCell>
                        <TableCell>+{boostFor(size, step, cap)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">
                  {setting.updatedBy
                    ? `Last changed by ${setting.updatedBy}${
                        setting.updatedAt
                          ? ` on ${new Date(setting.updatedAt).toLocaleString()}`
                          : ""
                      }`
                    : "Never saved: the boost is off."}
                </p>
                <Button onClick={save} disabled={!valid || saving}>
                  {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
