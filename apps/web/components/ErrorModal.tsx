"use client";

import { useState } from "react";
import ErrorPage from "./ErrorPage";

type ErrorModalProps = {
  error: Error | string | { message: string };
  statusCode?: number;
  headline?: string;
  userSteps?: Array<{ title: string; description?: string; cta?: string }>;
  context?: string;
  debugDetails?: Array<{ label: string; value: string }>;
  stateTimeline?: Array<{ step: string; detail?: string; timestamp?: string }>;
  primaryActionLabel?: string;
  primaryActionHref?: string;
  onClose?: () => void;
  className?: string;
  primaryActionHrefOverride?: string;
};

type ReportStatus = {
  tone: "success" | "error";
  message: string;
};

export default function ErrorModal(props: ErrorModalProps) {
  const {
    error,
    statusCode,
    headline,
    userSteps,
    context,
    debugDetails,
    stateTimeline,
    primaryActionLabel,
    primaryActionHref,
    primaryActionHrefOverride,
    onClose,
    className,
  } = props;

  const [open, setOpen] = useState(true);
  const [reportStatus, setReportStatus] = useState<ReportStatus | null>(null);
  const handleClose = () => {
    setOpen(false);
    setReportStatus(null);
    onClose?.();
  };

  if (!open) return null;

  const showFooter =
    reportStatus ||
    primaryActionHref ||
    primaryActionHrefOverride ||
    primaryActionLabel;

  const footerLayout = reportStatus ? "justify-between" : "justify-end";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 sm:p-6">
      <div className={`relative w-full max-w-5xl ${className || ""}`}>
        <div
          className="absolute inset-4 rounded-[28px] bg-gradient-to-br from-indigo-200/40 via-white/20 to-indigo-300/30 blur-2xl"
          aria-hidden
        />
        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white/95 backdrop-blur shadow-2xl max-h-[90vh] flex flex-col">
          <button
            aria-label="Close error"
            onClick={handleClose}
            className="absolute right-4 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-slate-700 shadow-md hover:text-slate-900 hover:bg-white"
          >
            ×
          </button>

          <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-transparent">
            <ErrorPage
              variant="modal"
              error={error}
              statusCode={statusCode}
              headline={headline}
              userSteps={userSteps}
              context={context}
              debugDetails={debugDetails}
              stateTimeline={stateTimeline}
              className="shadow-none"
              onReportStatusChange={setReportStatus}
            />
          </div>

          {showFooter ? (
            <div
              className={`border-t border-slate-200 bg-white/90 px-6 sm:px-8 py-4 flex flex-wrap items-center gap-3 ${footerLayout}`}
            >
              {reportStatus ? (
                <span
                  role="status"
                  aria-live="polite"
                  className={`rounded-md border px-3 py-2 text-sm font-medium ${
                    reportStatus.tone === "success"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-rose-200 bg-rose-50 text-rose-700"
                  }`}
                >
                  {reportStatus.message}
                </span>
              ) : null}
              {primaryActionHref ||
              primaryActionHrefOverride ||
              primaryActionLabel ? (
                <a
                  href={primaryActionHrefOverride || primaryActionHref || "#"}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-indigo-700"
                >
                  {primaryActionLabel || "Go back"}
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
