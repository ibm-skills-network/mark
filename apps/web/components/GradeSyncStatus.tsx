"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

interface GradeSyncStatusProps {
  attemptId: number;
  assignmentId: number;
}

interface SyncStatus {
  id: number;
  status: "PENDING" | "IN_PROGRESS" | "SUCCESS" | "FAILED" | "SCHEDULED";
  grade: number;
  retryCount: number;
  maxRetries: number;
  lastError?: string;
  nextRetryAt?: string;
  completedAt?: string;
  canRetry: boolean;
}

function formatCountdown(ms: number) {
  if (ms <= 0) return "now";

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  // For times over 1 hour, show hours, minutes, and seconds
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  // For times over 1 minute, show minutes and seconds
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  // For times under 1 minute, show just seconds
  return `${seconds}s`;
}

/**
 * Component to display LTI grade sync status to learners.
 * Shows real-time status of grade syncing to their course platform.
 */
export default function GradeSyncStatus({
  attemptId,
  assignmentId,
}: GradeSyncStatusProps) {
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    fetchSyncStatus();

    const interval = setInterval(() => {
      if (syncStatus?.status !== "SUCCESS") {
        fetchSyncStatus();
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [attemptId]);

  const fetchSyncStatus = async () => {
    try {
      const response = await fetch(
        `/api/v2/assignments/${assignmentId}/attempts/${attemptId}/grade-sync-status`,
        {
          credentials: "include", // pragma: allowlist secret
        },
      );

      if (response.ok) {
        const data = await response.json();
        setSyncStatus(data);
      } else if (response.status === 404 || response.status === 401) {
        setSyncStatus(null);
      } else {
        console.error("Failed to fetch grade sync status:", response.status);
      }
    } catch (error) {
      console.error("Error fetching grade sync status:", error);
    } finally {
      setLoading(false);
    }
  };

  const nextRetryMs = useMemo(() => {
    if (!syncStatus?.nextRetryAt) return null;
    const t = new Date(syncStatus.nextRetryAt).getTime();
    return Number.isFinite(t) ? t : null;
  }, [syncStatus?.nextRetryAt]);

  useEffect(() => {
    if (syncStatus?.status !== "SCHEDULED" || !nextRetryMs) return;

    const id = globalThis.setInterval(() => setNowMs(Date.now()), 1000);
    return () => globalThis.clearInterval(id);
  }, [syncStatus?.status, nextRetryMs]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <div className="w-4 h-4 border-2 border-gray-300 border-t-violet-600 rounded-full animate-spin" />
        <span>Checking grade sync status...</span>
      </div>
    );
  }

  if (!syncStatus) {
    return null;
  }

  const remainingMs =
    syncStatus.status === "SCHEDULED" && nextRetryMs ? nextRetryMs - nowMs : 0;

  const countdownLabel =
    syncStatus.status === "SCHEDULED"
      ? nextRetryMs
        ? remainingMs > 0
          ? formatCountdown(remainingMs)
          : "Retrying now…"
        : "—"
      : null;
  const getStatusDisplay = () => {
    switch (syncStatus.status) {
      case "SUCCESS":
        return {
          icon: "✅",
          color: "text-green-600",
          bgColor: "bg-green-50",
          borderColor: "border-green-200",
          message: "Grade successfully synced to your course platform",
        };

      case "IN_PROGRESS":
      case "PENDING":
        return {
          icon: "⏳",
          color: "text-blue-600",
          bgColor: "bg-blue-50",
          borderColor: "border-blue-200",
          message: "Syncing grade to your course platform...",
        };

      case "SCHEDULED": {
        const retryTime = syncStatus.nextRetryAt
          ? new Date(syncStatus.nextRetryAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "soon";
        return {
          icon: "🔄",
          color: "text-yellow-600",
          bgColor: "bg-yellow-50",
          borderColor: "border-yellow-200",
          message: `Retry scheduled for ${retryTime} (Attempt ${syncStatus.retryCount}/${syncStatus.maxRetries})`,
          detail:
            "We encountered an issue syncing your grade with your LMS. We'll automatically retry soon.",
        };
      }

      case "FAILED":
        return {
          icon: "⚠️",
          color: "text-red-600",
          bgColor: "bg-red-50",
          borderColor: "border-red-200",
          message: "Grade sync failed after multiple attempts",
          detail:
            "Your grade is safely stored in our system. Please contact your instructor if it doesn't appear in your course within 24 hours.",
        };

      default:
        return null;
    }
  };

  const statusDisplay = getStatusDisplay();

  if (!statusDisplay) {
    return null;
  }

  return (
    <div
      className={`p-4 mt-5 rounded-lg border ${statusDisplay.bgColor} ${statusDisplay.borderColor}`}
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl">{statusDisplay.icon}</span>
        <div className="flex-1">
          <p className={`font-medium ${statusDisplay.color}`}>
            {statusDisplay.message}
          </p>
          {statusDisplay.detail && (
            <p className="text-sm text-gray-600 mt-1">{statusDisplay.detail}</p>
          )}
          {syncStatus.status === "SCHEDULED" && (
            <div className="text-sm text-gray-600 mt-2">
              Next retry in:{" "}
              <span className="font-medium">{countdownLabel}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
