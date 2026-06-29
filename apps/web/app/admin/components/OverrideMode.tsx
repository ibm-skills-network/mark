"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { enterOverrideMode } from "@/lib/admin-session";

interface OverrideModeProps {
  sessionToken: string | null | undefined;
}

export function OverrideMode({ sessionToken }: OverrideModeProps) {
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [assignmentId, setAssignmentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const activate = async () => {
    if (!sessionToken) return;
    setError(null);
    setLoading(true);
    try {
      const result = await enterOverrideMode(sessionToken);
      setExpiresAt(result.expiresAt);
    } catch {
      setError("Could not enter override mode");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="outline"
        onClick={activate}
        disabled={!sessionToken || loading}
        size="sm"
      >
        Enter override mode
      </Button>
      {error && <span className="text-sm text-red-600">{error}</span>}
      {expiresAt && (
        <div className="flex items-center gap-2">
          <span className="text-sm">
            Override active until{" "}
            {new Date(expiresAt).toLocaleTimeString()}
          </span>
          <input
            placeholder="Assignment ID"
            value={assignmentId}
            onChange={(e) =>
              setAssignmentId(e.target.value.replace(/\D/g, ""))
            }
            className="border rounded px-2 py-1 w-32 text-sm"
          />
          <Button
            size="sm"
            disabled={!assignmentId}
            onClick={() => {
              window.location.href = `/author/${assignmentId}`;
            }}
          >
            Open
          </Button>
        </div>
      )}
    </div>
  );
}
