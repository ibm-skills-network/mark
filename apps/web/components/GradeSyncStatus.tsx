"use client";

import { InformationCircleIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import { isYourLearningHost } from "@/lib/portal";

interface GradeSyncStatusProps {
  attemptId: number;
  assignmentId: number;
  /** Session lmsHost from /user-session; selects the yourLearning notice. */
  lmsHost?: string;
}

export const YOUR_LEARNING_SYNC_HEADING =
  "Your grade is on its way to yourLearning";
export const YOUR_LEARNING_SYNC_MESSAGE =
  "Syncing your grade to yourLearning can take a few hours, so please be patient. Your grade is safely recorded with us and there's nothing you need to do. You can close this window.";

/**
 * Every English string the yourLearning notice renders. The UI translation
 * catalogs are keyed by exact source text, so a test checks each one is
 * present in every language.
 */
export const YOUR_LEARNING_SYNC_SOURCE_STRINGS: readonly string[] = [
  YOUR_LEARNING_SYNC_HEADING,
  YOUR_LEARNING_SYNC_MESSAGE,
];

/**
 * yourLearning can take hours to show a grade even after it is delivered, so
 * its learners get one steady notice instead of the per-status boxes.
 */
function YourLearningSyncNotice() {
  return (
    <div
      role="status"
      data-testid="yourlearning-sync-notice"
      className="p-5 sm:p-6 mt-5 rounded-xl border-2 border-blue-300 bg-blue-50 shadow-sm"
    >
      <div className="flex items-start gap-4">
        <span className="flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-full bg-blue-100">
          <InformationCircleIcon
            className="w-7 h-7 text-blue-600"
            aria-hidden="true"
          />
        </span>
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-blue-800">
            {YOUR_LEARNING_SYNC_HEADING}
          </h2>
          <p className="text-base text-gray-700 mt-1">
            {YOUR_LEARNING_SYNC_MESSAGE}
          </p>
        </div>
      </div>
    </div>
  );
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

/**
 * Component to display LTI grade sync status to learners.
 * Shows the status of syncing their completion to their course platform.
 */
export default function GradeSyncStatus({
  attemptId,
  assignmentId,
  lmsHost,
}: GradeSyncStatusProps) {
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSyncStatus();
  }, [attemptId, assignmentId]);

  const fetchSyncStatus = async () => {
    try {
      const response = await fetch(
        `/api/v2/assignments/${assignmentId}/attempts/${attemptId}/grade-sync-status`,
        {
          credentials: "include", // pragma: allowlist secret
        },
      );

      if (response.ok) {
        // An attempt with no sync row answers 200 with an empty body.
        const body = await response.text();
        setSyncStatus(body ? (JSON.parse(body) as SyncStatus | null) : null);
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

  const getStatusDisplay = () => {
    switch (syncStatus.status) {
      case "SUCCESS":
        return {
          icon: "✅",
          color: "text-green-600",
          bgColor: "bg-green-50",
          borderColor: "border-green-200",
          message: "Your completion was sent to your course platform",
          detail:
            "It may take a couple of hours for your course platform to display it. There's nothing you need to do. You can close this window.",
        };

      case "IN_PROGRESS":
      case "PENDING":
        return {
          icon: "⏳",
          color: "text-blue-600",
          bgColor: "bg-blue-50",
          borderColor: "border-blue-200",
          message: "Syncing your completion to your course platform...",
          detail:
            "Your completion is recorded with us. It may take a couple of hours to appear in your course. You can close this window.",
        };

      case "SCHEDULED":
        return {
          icon: "⏳",
          color: "text-blue-600",
          bgColor: "bg-blue-50",
          borderColor: "border-blue-200",
          message: "Your completion is safely recorded with us",
          detail:
            "We're still syncing your completion to your course platform. It may take as long as 4–6 hours depending on how quickly your course platform responds, but we'll make sure your quiz gets there. There's nothing you need to do — your completion is safely recorded with us and will appear in your course as soon as it's accepted. You can close this window.",
        };

      case "FAILED":
        return {
          icon: "ℹ️",
          color: "text-blue-600",
          bgColor: "bg-blue-50",
          borderColor: "border-blue-200",
          message: "Your completion is safely recorded with us",
          detail:
            "Your completion is stored safely on our end and we're working to get it into your course platform. If it hasn't appeared in your course within 24 hours, please reach out to your instructor.",
        };

      default:
        return null;
    }
  };

  const statusDisplay = getStatusDisplay();

  if (!statusDisplay) {
    return null;
  }

  if (isYourLearningHost(lmsHost)) {
    return <YourLearningSyncNotice />;
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
        </div>
      </div>
    </div>
  );
}
