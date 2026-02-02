import { NextRequest, NextResponse } from "next/server";
import {
  IssueReportDetails,
  ReportingService,
} from "@/app/api/markChat/services/reportingService";
import { getUser } from "@/lib/shared";

function extractIds(debugDetails: any[]) {
  const findValue = (label: string) =>
    debugDetails?.find((d) => d?.label === label)?.value;
  const assignmentId = findValue("AssignmentId") || findValue("assignmentId");
  const attemptId = findValue("AttemptId") || findValue("attemptId");
  return {
    assignmentId: assignmentId ? Number(assignmentId) : undefined,
    attemptId: attemptId ? Number(attemptId) : undefined,
  };
}

function buildDescription(body: any): { title: string; description: string } {
  const {
    statusCode,
    headline,
    message,
    context,
    debugDetails = [],
    stateTimeline = [],
    prefill,
  } = body || {};

  const title =
    typeof headline === "string" && headline.length > 0
      ? `Frontend error: ${headline}`
      : "Frontend error";

  const debugSection =
    debugDetails.length > 0
      ? debugDetails
          .map(
            (entry: any) =>
              `${entry?.label ?? "Detail"}: ${String(entry?.value ?? "")}`,
          )
          .join("\n")
      : "No debug details provided.";

  const timelineSection =
    stateTimeline.length > 0
      ? stateTimeline
          .map((event: any, idx: number) => {
            const time = event?.timestamp
              ? new Intl.DateTimeFormat("en", {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                }).format(new Date(event.timestamp))
              : "No time";
            return `${idx + 1}. ${event?.step ?? "Unknown step"} @ ${time}${
              event?.detail ? ` — ${event.detail}` : ""
            }`;
          })
          .join("\n")
      : "No state timeline captured.";

  const descriptionParts = [
    `## Summary`,
    `- Status: ${statusCode ?? "unknown"} — ${headline ?? "N/A"}`,
    `- Message: ${message ?? "N/A"}`,
    context ? `- Context: ${context}` : null,
    "",
    "## Debug details",
    debugSection,
    "",
    "## State timeline (most recent first)",
    timelineSection,
    "",
    "## Prefill text (user-facing report)",
    prefill ?? "N/A",
  ].filter(Boolean);

  return { title, description: descriptionParts.join("\n") };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      statusCode,
      headline,
      message,
      context,
      debugDetails,
      stateTimeline,
      prefill,
    } = body || {};
    const { assignmentId, attemptId } = extractIds(debugDetails || []);

    let userEmail: string | undefined;
    let userRole: "author" | "learner" | "system" | undefined;
    try {
      const user = await getUser(req.headers.get("cookie") || undefined);
      userEmail = (user as any)?.email || (user as any)?.userId;
      userRole = user?.role;
    } catch {
      // User authentication failed - continue with anonymous error report
    }

    const { title, description } = buildDescription(body);

    const details: IssueReportDetails = {
      issueType: "frontend_error",
      severity: "error",
      category: "UI Error",
      statusCode,
      headline,
      message,
      context,
      debugDetails,
      stateTimeline,
      prefill,
      assignmentId,
      attemptId,
      userEmail,
      userRole,
      environment: process.env.NODE_ENV || "unknown",
    };

    const cookieHeader = req.headers.get("cookie") || undefined;
    const report = await ReportingService.reportIssue(
      title,
      description,
      details,
      cookieHeader,
    );

    if (!report.success) {
      return NextResponse.json(
        { error: report.error ?? "Report failed", message: report.content },
        { status: 502 },
      );
    }

    return NextResponse.json({
      message: report.content,
      issueNumber: report.issueNumber,
      reportId: report.reportId,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to forward error report" },
      { status: 500 },
    );
  }
}
