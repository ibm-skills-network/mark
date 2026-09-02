"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, ExternalLink } from "lucide-react";
import {
  deleteLearnerAttempt,
  forcePassAttempt,
  getLearnerAttempts,
  type LearnerAttemptSummary,
} from "@/lib/shared";

interface LearnerAttemptsTableProps {
  sessionToken?: string | null;
}

// Use the backend default when an assignment has no passing grade.
const DEFAULT_PASSING_GRADE = 50;

// Scale the threshold down to avoid floating-point cutoff errors.
function isPassing(attempt: LearnerAttemptSummary): boolean {
  if (attempt.grade === null) return false;
  return attempt.grade >= (attempt.passingGrade ?? DEFAULT_PASSING_GRADE) / 100;
}

type PendingAction = { attemptId: number; kind: "pass" | "delete" };

/** Lists a learner's attempts and supports pass or delete actions. */
export function LearnerAttemptsTable({
  sessionToken,
}: LearnerAttemptsTableProps) {
  const [query, setQuery] = useState("");
  const [searchedFor, setSearchedFor] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<LearnerAttemptSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [running, setRunning] = useState<PendingAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const search = async () => {
    const userId = query.trim();
    if (!sessionToken || !userId) return;
    setLoading(true);
    setError(null);
    setActionError(null);
    setPending(null);
    try {
      setAttempts(await getLearnerAttempts(sessionToken, userId));
      setSearchedFor(userId);
    } catch (err) {
      setAttempts([]);
      setSearchedFor(userId);
      setError(
        err instanceof Error ? err.message : "Failed to look up this learner",
      );
    } finally {
      setLoading(false);
    }
  };

  const runAction = async (action: PendingAction) => {
    if (!sessionToken) return;
    setRunning(action);
    setActionError(null);
    try {
      if (action.kind === "pass") {
        await forcePassAttempt(sessionToken, action.attemptId);
        // Update locally; force-pass has already persisted the grade and status.
        setAttempts((prev) =>
          prev.map((attempt) =>
            attempt.id === action.attemptId
              ? {
                  ...attempt,
                  grade: 1,
                  submitted: true,
                  gradingStatus: "COMPLETED",
                }
              : attempt,
          ),
        );
      } else {
        await deleteLearnerAttempt(sessionToken, action.attemptId);
        setAttempts((prev) =>
          prev.filter((attempt) => attempt.id !== action.attemptId),
        );
      }
      setPending(null);
    } catch (err) {
      setPending(null);
      setActionError(
        err instanceof Error
          ? err.message
          : `Failed to ${action.kind} attempt ${action.attemptId}`,
      );
    } finally {
      setRunning(null);
    }
  };

  const isRunning = (attemptId: number) => running?.attemptId === attemptId;

  return (
    <div className="p-6 space-y-4">
      <div className="space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Learner user ID or email"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void search();
              }}
              className="pl-10"
            />
          </div>
          <Button
            onClick={() => void search()}
            disabled={loading || !query.trim()}
          >
            {loading ? "Searching…" : "Search"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Pass sets the attempt to 100% and re-syncs to the LMS. Delete frees up
          one of the learner&apos;s attempts so they can start over — it does
          not lower their LMS grade.
        </p>
      </div>

      {error && (
        <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
      )}
      {actionError && (
        <div className="text-sm text-red-600 dark:text-red-400">
          {actionError}
        </div>
      )}

      {searchedFor && !loading && !error && attempts.length === 0 && (
        <div className="text-center text-muted-foreground py-8">
          No attempts found for {searchedFor}
        </div>
      )}

      {attempts.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Assignment</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-center">Grade</TableHead>
              <TableHead>Started</TableHead>
              <TableHead className="text-right w-[320px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {attempts.map((attempt) => (
              <TableRow key={attempt.id}>
                <TableCell>
                  <a
                    href={`/admin/insights/${attempt.assignmentId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium hover:underline inline-flex items-center gap-1"
                  >
                    {attempt.assignmentName}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  <div className="text-xs text-muted-foreground">
                    Attempt {attempt.id} · Assignment {attempt.assignmentId}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={attempt.submitted ? "default" : "secondary"}>
                    {attempt.submitted ? "Submitted" : "In Progress"}
                  </Badge>
                  {attempt.gradingStatus &&
                    attempt.gradingStatus !== "COMPLETED" && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Grading: {attempt.gradingStatus}
                      </div>
                    )}
                </TableCell>
                <TableCell className="text-center">
                  {attempt.grade === null ? (
                    "N/A"
                  ) : (
                    <span
                      className={
                        isPassing(attempt)
                          ? "text-green-600 dark:text-green-400 font-semibold"
                          : "text-red-600 dark:text-red-400 font-semibold"
                      }
                    >
                      {Math.round(attempt.grade * 100)}%
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {new Date(attempt.createdAt).toLocaleString()}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {pending?.attemptId === attempt.id ? (
                    <div className="flex items-center justify-end gap-2">
                      <span className="text-xs text-muted-foreground">
                        {pending.kind === "pass"
                          ? "Pass at 100%?"
                          : "Delete this attempt?"}
                      </span>
                      <Button
                        variant={
                          pending.kind === "pass" ? "default" : "destructive"
                        }
                        size="sm"
                        disabled={isRunning(attempt.id)}
                        onClick={() => void runAction(pending)}
                      >
                        {isRunning(attempt.id) ? "Working…" : "Confirm"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isRunning(attempt.id)}
                        onClick={() => setPending(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-end gap-2">
                      {!isPassing(attempt) && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setPending({
                              attemptId: attempt.id,
                              kind: "pass",
                            })
                          }
                        >
                          Pass
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setPending({ attemptId: attempt.id, kind: "delete" })
                        }
                      >
                        Delete
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
