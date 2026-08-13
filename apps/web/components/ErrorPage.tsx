"use client";

import { useMemo } from "react";
import ReportErrorButton from "@/components/ReportErrorButton";
import { cn } from "@/lib/strings";

type UserStep = {
  title: string;
  description?: string;
  cta?: string;
};

type DebugEntry = {
  label: string;
  value: string;
};

type StateEvent = {
  step: string;
  detail?: string;
  timestamp?: string;
};

type ErrorInput = Error | string | { message: string };

const DEFAULT_HEADLINES: Record<number, string> = {
  401: "Authentication required",
  403: "Access is restricted",
  404: "We couldn't find that",
  409: "There's a conflict to resolve",
  422: "We couldn't process that request",
  429: "You're sending too many requests",
  500: "Something went wrong on our side",
  503: "Service is temporarily unavailable",
};

const DEFAULT_STEPS: Record<number, UserStep[]> = {
  401: [
    {
      title: "Sign in again",
      description: "Your session may have expired. Log in and retry.",
      cta: "Open sign-in",
    },
    {
      title: "Try refreshing",
      description: "Reload the page to establish a fresh session.",
    },
  ],
  403: [
    {
      title: "Check your role or permissions",
      description: "You may need instructor access or a valid enrollment.",
    },
    {
      title: "Use the correct course link",
      description: "Open the assignment directly from your LMS.",
    },
  ],
  404: [
    {
      title: "Verify the link",
      description: "Make sure the assignment URL is correct.",
    },
    {
      title: "Return to course",
      description: "Navigate from your course home to reopen this activity.",
    },
  ],
  422: [
    {
      title: "Review your inputs",
      description: "Fix any missing or invalid fields, then resubmit.",
    },
    {
      title: "Reduce file size or length",
      description: "Large uploads or very long responses may be rejected.",
    },
  ],
  500: [
    {
      title: "Retry in a moment",
      description: "We hit an unexpected error. Please try again shortly.",
    },
    {
      title: "Let us know if it persists",
      description:
        "Contact your instructor or support if this keeps happening.",
    },
  ],
};

function parseErrorMessage(error: ErrorInput): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message || "Unknown error";
  return error?.message || "Unknown error";
}

export default function ErrorPage({
  error,
  statusCode = 500,
  className,
  headline,
  userSteps,
  context,
  debugDetails = [],
  stateTimeline = [],
  variant = "page",
}: {
  error: ErrorInput;
  statusCode?: number;
  className?: string;
  headline?: string;
  userSteps?: UserStep[];
  context?: string;
  debugDetails?: DebugEntry[];
  stateTimeline?: StateEvent[];
  variant?: "page" | "modal";
}) {
  const errorMessage = useMemo(() => parseErrorMessage(error), [error]);

  const resolvedHeadline =
    headline ||
    DEFAULT_HEADLINES[statusCode] ||
    DEFAULT_HEADLINES[500] ||
    "Unexpected error";

  const resolvedSteps =
    userSteps && userSteps.length > 0
      ? userSteps
      : DEFAULT_STEPS[statusCode] || DEFAULT_STEPS[500] || [];

  // Only the genuinely-extra reference details. Status, headline, and message
  // already appear in the header, so we don't repeat them here. Context is
  // shown inline in the header too, so it's excluded as well.
  const supportDetails = debugDetails;

  const isModal = variant === "modal";
  const outerClasses = cn(
    isModal
      ? "w-full px-2 sm:px-4 py-6 text-gray-900"
      : "min-h-[70vh] w-full bg-slate-50 text-gray-900 flex items-center justify-center px-4 py-10",
    className,
  );

  const cardClasses = cn(
    "mx-auto w-full rounded-2xl border border-slate-200 bg-white",
    isModal ? "" : "max-w-2xl shadow-sm",
  );

  const paddingClasses = isModal ? "p-6 md:p-8" : "p-8";

  return (
    <div className={outerClasses}>
      <div className={cardClasses}>
        <div className={`flex flex-col gap-6 ${paddingClasses}`}>
          <div className="flex items-baseline gap-3">
            <span className="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500 tabular-nums">
              {statusCode}
            </span>
            <div className="space-y-1">
              <h1 className="text-xl font-bold text-gray-900">
                {resolvedHeadline}
              </h1>
              {errorMessage && errorMessage !== resolvedHeadline ? (
                <p className="text-gray-600">{errorMessage}</p>
              ) : null}
              {context ? (
                <p className="text-sm text-gray-500">{context}</p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-3">
            <ReportErrorButton
              error={{
                statusCode,
                headline: resolvedHeadline,
                message: errorMessage,
                context,
                stateTimeline,
              }}
            />
            <p className="text-sm text-red-900/80">
              Something wrong? Send this error to our team — the details are
              attached automatically.
            </p>
          </div>

          {resolvedSteps.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                What you can do
              </h3>
              <ol className="space-y-2">
                {resolvedSteps.map((step, idx) => (
                  <li key={idx} className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">
                      {idx + 1}
                    </span>
                    <div>
                      <span className="font-medium text-gray-900">
                        {step.title}
                      </span>
                      {step.description ? (
                        <span className="text-gray-600">
                          {" "}
                          — {step.description}
                        </span>
                      ) : null}
                      {step.cta ? (
                        <span className="ml-2 inline-flex items-center rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                          {step.cta}
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {supportDetails.length > 0 ? (
            <dl className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              {supportDetails.map((entry, idx) => (
                <div
                  key={`${entry.label}-${idx}`}
                  className="grid grid-cols-3 gap-2"
                >
                  <dt className="col-span-1 text-gray-500">{entry.label}</dt>
                  <dd className="col-span-2 text-gray-800 break-words">
                    {entry.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          {stateTimeline.length > 0 ? (
            <details className="rounded-lg border border-slate-200 bg-slate-50 text-sm">
              <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Recent activity ({stateTimeline.length})
              </summary>
              <ul className="max-h-56 overflow-auto border-t border-slate-200 px-3 py-2 space-y-1.5">
                {[...stateTimeline].reverse().map((event, idx) => {
                  const formattedTime = event.timestamp
                    ? new Intl.DateTimeFormat("en", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      }).format(new Date(event.timestamp))
                    : null;
                  return (
                    <li
                      key={`${event.step}-${idx}`}
                      className="flex items-baseline justify-between gap-3"
                    >
                      <span className="text-gray-700">
                        <span className="font-medium text-gray-900">
                          {event.step}
                        </span>
                        {event.detail ? (
                          <span className="text-gray-500">
                            {" "}
                            — {event.detail}
                          </span>
                        ) : null}
                      </span>
                      {formattedTime ? (
                        <span className="shrink-0 text-[11px] tabular-nums text-gray-400">
                          {formattedTime}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </details>
          ) : null}
        </div>
      </div>
    </div>
  );
}
