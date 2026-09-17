"use client";

import { useEffect, useState } from "react";
import {
  getAdminReportDiagnostics,
  type AdminReportDiagnostics,
} from "@/lib/talkToBackend";

type LoadState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "failed" }
  | { kind: "loaded"; capture: AdminReportDiagnostics };

const failed = (status: number | null) => status === null || status >= 400;

/**
 * What the reporter's browser held when they filed the report. Admin only:
 * the API refuses the read without a valid admin token, so this panel is a
 * view of that answer, not the gate.
 */
export function ReportDiagnosticsPanel({
  reportId,
  sessionToken,
}: {
  reportId: number;
  sessionToken: string;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    getAdminReportDiagnostics(reportId, sessionToken)
      .then((capture) => {
        if (cancelled) return;
        setState(capture ? { kind: "loaded", capture } : { kind: "none" });
      })
      .catch((error: unknown) => {
        console.error("ReportDiagnosticsPanel: load failed", error);
        if (!cancelled) setState({ kind: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [reportId, sessionToken]);

  if (state.kind === "loading") {
    return <p className="text-sm text-muted-foreground">Loading diagnostics…</p>;
  }
  if (state.kind === "none") {
    return (
      <p className="text-sm text-muted-foreground">
        No diagnostics were captured for this report.
      </p>
    );
  }
  if (state.kind === "failed") {
    return (
      <p className="text-sm text-red-700">
        Could not load diagnostics. Check your admin session and try again.
      </p>
    );
  }

  const { session, page, rendered, requests, draft } =
    state.capture.diagnostics;
  const facts: [string, unknown][] = [
    ["Attempt", session?.attemptId],
    ["Assignment", session?.assignmentId],
    ["Role", session?.role],
    ["Attempt language", session?.attemptLanguage],
    ["UI language", session?.uiLanguage],
    ["Build", session?.buildVersion],
    ["In iframe", page?.inIframe === undefined ? undefined : String(page.inIframe)],
    ["Viewport", page?.viewport],
    ["Clock skew (ms)", page?.clockSkewMs],
    ["Draft belongs to attempt", draft?.activeAttemptId],
    ["Page", page?.url],
    ["Browser", page?.userAgent],
  ];

  return (
    <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        {facts
          .filter(([, value]) => value !== undefined && value !== null)
          .map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-all">{String(value)}</dd>
            </div>
          ))}
      </dl>

      {requests && requests.length > 0 && (
        <div>
          <h4 className="font-medium mb-1">Recent requests</h4>
          <ul className="space-y-1 font-mono text-xs">
            {requests.map((request, index) => (
              <li
                key={`${request.at ?? ""}-${index}`}
                className={failed(request.status) ? "text-red-700" : ""}
              >
                <span>{request.status ?? "no response"}</span>{" "}
                {request.method} {request.path}
                {request.ms === undefined ? "" : ` · ${request.ms}ms`}
                {request.requestId ? ` · id ${request.requestId}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {rendered && rendered.length > 0 && (
        <div>
          <h4 className="font-medium mb-1">Choices as shown to the reporter</h4>
          <ul className="space-y-2">
            {rendered.map((question) => (
              <li key={question.questionId}>
                <span className="text-muted-foreground">
                  Question {question.questionId}
                </span>
                <ul className="ml-4">
                  {question.choices.map((choice, index) => (
                    <li key={index}>
                      <span aria-hidden>{choice.selected ? "● " : "○ "}</span>
                      <span className={choice.selected ? "font-medium" : ""}>
                        {choice.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
