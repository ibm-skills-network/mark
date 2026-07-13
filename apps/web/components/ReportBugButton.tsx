"use client";

import { FlagIcon } from "@heroicons/react/24/outline";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import ReportPreviewModal from "@/components/ReportPreviewModal";
import { getBaseApiPath } from "@/config/constants";
import type { User } from "@/config/types";
import { getUser } from "@/lib/talkToBackend";

interface ReportSubmission {
  issueType?: string;
  description?: string;
  severity?: string;
  screenshot?: File | null;
  userEmail?: string;
  assignmentId?: number;
}

/**
 * Floating flag button that lets users report a bug from any main screen,
 * independent of the chatbot. Reuses the same report form and endpoint as
 * the chat flow so reports land in GitHub with the standard template.
 */
export default function ReportBugButton() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let cancelled = false;
    getUser()
      .then((fetched) => {
        if (!cancelled) setUser(fetched ?? null);
      })
      .catch(() => {
        // Anonymous visitors can still report; the email field stays editable.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const initialData = useMemo(
    () => ({
      userEmail: user?.userId,
      assignmentId: user?.assignmentId,
    }),
    [user?.userId, user?.assignmentId],
  );

  const handleSubmit = useCallback(
    async (action: string, value?: ReportSubmission) => {
      if (action !== "submit" || !value) return;

      try {
        const formData = new FormData();
        formData.append("issueType", value.issueType || "technical");
        formData.append("description", value.description || "");
        formData.append("severity", value.severity || "info");
        formData.append("category", "Flag Button Report");
        formData.append("userRole", user?.role || "learner");

        const resolvedEmail = value.userEmail || user?.userId;
        if (resolvedEmail) {
          formData.append("userEmail", resolvedEmail);
        }

        const assignmentId = value.assignmentId ?? user?.assignmentId;
        if (assignmentId) {
          formData.append("assignmentId", String(assignmentId));
        }

        if (value.screenshot) {
          formData.append("screenshot", value.screenshot);
          toast.info("Submitting report with screenshot...");
        } else {
          toast.info("Submitting report...");
        }

        const response = await fetch(`${getBaseApiPath("v1")}/reports`, {
          method: "POST",
          credentials: "include",
          body: formData,
        });

        if (!response.ok) {
          const errorBody = (await response.json().catch(() => ({}))) as {
            message?: string;
          };
          throw new Error(errorBody.message || `HTTP error ${response.status}`);
        }

        toast.success("Bug report submitted. Thank you!");
      } catch (error) {
        console.error("ReportBugButton: report submit failed:", error);
        toast.error("Failed to submit report. Please try again.");
      }
    },
    [user],
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setIsModalOpen(true)}
        title="Report a bug"
        aria-label="Report a bug"
        className="fixed bottom-4 right-4 z-40 inline-flex items-center justify-center p-2.5 rounded-full text-red-600 dark:text-red-400 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-md hover:shadow-lg hover:bg-red-50 dark:hover:bg-gray-700 transition-all duration-200"
      >
        <FlagIcon className="w-5 h-5" />
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
