"use client";

import { FlagIcon } from "@heroicons/react/24/solid";
import { useCallback, useMemo, useRef, useState } from "react";
import ReportPreviewModal from "@/components/ReportPreviewModal";
import type { User } from "@/config/types";
import {
  buildErrorReportPrefills,
  submitBugReport,
  type BugReportSubmission,
  type ErrorReportContext,
} from "@/lib/report-client";
import { getUser } from "@/lib/talkToBackend";

/**
 * The report action shown on every error screen/dialog. Deliberately loud:
 * error reports used to go through the (removed) chatbot, and anything less
 * obvious sends users to Slack instead. The form opens with every required
 * field prefilled from the error, so a report is one click plus "Submit".
 */
export default function ReportErrorButton({
  error,
  className,
}: {
  error: ErrorReportContext;
  className?: string;
}) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const userRequested = useRef(false);

  const openReport = useCallback(() => {
    // Fetched on first open, not on mount: error screens also render for
    // signed-out users, where this call can only fail.
    if (!userRequested.current) {
      userRequested.current = true;
      getUser()
        .then((fetched) => setUser(fetched ?? null))
        .catch(() => {
          // Anonymous visitors can still report; the email field stays editable.
        });
    }
    setIsModalOpen(true);
  }, []);

  const initialData = useMemo(
    () => ({
      userEmail: user?.userId,
      assignmentId: user?.assignmentId,
      severity: "error",
      fieldPrefills: buildErrorReportPrefills(error, {
        pagePath:
          typeof window !== "undefined"
            ? window.location.pathname
            : undefined,
        userAgent:
          typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      }),
    }),
    [user, error],
  );

  const handleSubmit = useCallback(
    async (action: string, value?: BugReportSubmission) => {
      if (action !== "submit" || !value) return;
      await submitBugReport(value, {
        category: "Error Dialog Report",
        user,
      });
    },
    [user],
  );

  return (
    <>
      <button
        type="button"
        onClick={openReport}
        className={`inline-flex items-center gap-2 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 ${className || ""}`}
      >
        <FlagIcon className="w-4 h-4" aria-hidden />
        Report this issue
      </button>

      <ReportPreviewModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        reportType="report"
        initialData={initialData}
        isAuthor={user?.role === "author"}
        onSubmit={handleSubmit}
      />
    </>
  );
}
