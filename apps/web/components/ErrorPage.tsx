"use client";

import { useMemo } from "react";
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
      description: "Contact your instructor or support if this keeps happening.",
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

  const enrichedDebugDetails: DebugEntry[] = useMemo(() => {
    const base: DebugEntry[] = [
      { label: "Status Code", value: String(statusCode) },
      { label: "Headline", value: resolvedHeadline },
      { label: "Message", value: errorMessage },
    ];
    if (context) {
      base.push({ label: "Context", value: context });
    }
    return [...base, ...debugDetails];
  }, [statusCode, resolvedHeadline, errorMessage, context, debugDetails]);

  const isModal = variant === "modal";
  const outerClasses = cn(
    isModal
      ? "w-full px-2 sm:px-4 py-6 text-gray-900 bg-gradient-to-br from-white via-white to-slate-50"
      : "min-h-[70vh] w-full bg-gradient-to-br from-slate-50 via-white to-indigo-50 text-gray-900 flex items-center justify-center px-4 py-10",
    className,
  );

  const cardClasses = cn(
    "mx-auto w-full rounded-2xl border border-slate-200 bg-white shadow-xl",
    isModal ? "" : "max-w-4xl bg-white/95 backdrop-blur-sm",
  );

  const paddingClasses = isModal ? "p-6 md:p-8" : "p-8 md:p-10";

  return (
    <div className={outerClasses}>
      <div className={cardClasses}>
        <div className={`flex flex-col gap-6 ${paddingClasses}`}>
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100">
              <span className="text-xl font-bold">{statusCode}</span>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-indigo-600 font-semibold">
                Attention needed
              </p>
              <h1 className="text-2xl font-bold text-gray-900">
                {resolvedHeadline}
              </h1>
              <p className="text-gray-600">{errorMessage}</p>
              {context ? (
                <p className="text-sm text-gray-500">Context: {context}</p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide mb-2">
                What you can do
              </h3>
              <div className="space-y-3">
                {resolvedSteps.map((step, idx) => (
                  <div
                    key={idx}
                    className="flex gap-3 rounded-lg border border-slate-200 bg-white/70 p-3 shadow-sm"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 font-semibold">
                      {idx + 1}
                    </div>
                    <div className="space-y-1">
                      <div className="font-semibold text-gray-900">
                        {step.title}
                      </div>
                      {step.description ? (
                        <div className="text-gray-600 text-sm leading-relaxed">
                          {step.description}
                        </div>
                      ) : null}
                      {step.cta ? (
                        <span className="inline-flex items-center rounded-md bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700 border border-indigo-100 shadow-inner">
                          {step.cta}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-2">
              <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide">
                Details for support
              </h3>
              <dl className="space-y-2 text-sm">
                {enrichedDebugDetails.map((entry, idx) => (
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
            </div>
          </div>

          {stateTimeline.length > 0 ? (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-4 shadow-inner space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-indigo-900 uppercase tracking-wide">
                    Recent activity
                  </h3>
                  <p className="text-xs text-indigo-800 mt-1">
                    Most recent events first.
                  </p>
                </div>
              </div>
              <div className="relative pl-4 max-h-60 overflow-auto pr-2">
                <div
                  className="absolute left-4 top-1 bottom-1 w-px bg-indigo-200"
                  aria-hidden
                />
                <div className="space-y-3">
                  {[...stateTimeline].reverse().map((event, idx) => {
                    const formattedTime = event.timestamp
                      ? new Intl.DateTimeFormat("en", {
                          year: "numeric",
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        }).format(new Date(event.timestamp))
                      : null;
                    return (
                      <div key={`${event.step}-${idx}`} className="relative pl-4">
                        <span className="absolute -left-[7px] mt-1 h-3 w-3 rounded-full border-2 border-white bg-indigo-500 shadow" />
                        <div className="rounded-lg bg-white/85 border border-indigo-100 px-3 py-2 shadow-sm">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-indigo-900">
                              {event.step}
                            </span>
                            {formattedTime ? (
                              <span className="text-[11px] text-indigo-700 whitespace-nowrap">
                                {formattedTime}
                              </span>
                            ) : null}
                          </div>
                          {event.detail ? (
                            <p className="text-sm text-indigo-800 mt-1 leading-relaxed">
                              {event.detail}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
