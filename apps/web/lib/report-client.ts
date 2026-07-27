import { toast } from "sonner";
import { getBaseApiPath } from "@/config/constants";
import type { User } from "@/config/types";

export interface BugReportSubmission {
  issueType?: string;
  description?: string;
  severity?: string;
  screenshot?: File | null;
  userEmail?: string;
  assignmentId?: number;
}

/**
 * Submits a bug report to the reports endpoint (same flow for the floating
 * flag button and the error-dialog report button, so reports land in GitHub
 * with the standard template). Returns whether the submission succeeded; all
 * user feedback (toasts) is handled here.
 */
export async function submitBugReport(
  value: BugReportSubmission,
  options: { category: string; user?: User | null },
): Promise<boolean> {
  const { category, user } = options;

  try {
    const formData = new FormData();
    formData.append("issueType", value.issueType || "technical");
    formData.append("description", value.description || "");
    formData.append("severity", value.severity || "info");
    formData.append("category", category);
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
    return true;
  } catch (error) {
    console.error("submitBugReport: report submit failed:", error);
    toast.error("Failed to submit report. Please try again.");
    return false;
  }
}

export interface ErrorReportContext {
  statusCode: number;
  headline: string;
  message?: string;
  context?: string;
  stateTimeline?: { step: string; detail?: string; timestamp?: string }[];
}

/**
 * Prefills for the report form's fields, built from the error the user is
 * looking at. Every required field gets a meaningful value so the report is
 * submittable as-is — the fewer hurdles between "saw an error" and "reported
 * it", the fewer errors go unreported.
 */
export function buildErrorReportPrefills(
  error: ErrorReportContext,
  environment?: { pagePath?: string; userAgent?: string },
): Record<string, string> {
  const pagePath = environment?.pagePath;
  const detailLines = [
    `Status: ${error.statusCode} — ${error.headline}`,
    error.message && error.message !== error.headline
      ? `Message: ${error.message}`
      : null,
    error.context ? `Context: ${error.context}` : null,
    pagePath ? `Page: ${pagePath}` : null,
  ].filter(Boolean);

  const timelineLines = (error.stateTimeline ?? []).map((event) =>
    [
      event.timestamp ? `[${event.timestamp}]` : null,
      event.step,
      event.detail ? `— ${event.detail}` : null,
    ]
      .filter(Boolean)
      .join(" "),
  );

  return {
    steps: [
      `1. I was using ${pagePath || "the page"} normally.`,
      "2. The error dialog appeared.",
      "(Auto-filled — please describe what you were doing if you can.)",
    ].join("\n"),
    expected: "The page keeps working without an error dialog.",
    actual: `An error dialog appeared:\n${detailLines.join("\n")}`,
    ...(environment?.userAgent ? { environment: environment.userAgent } : {}),
    ...(timelineLines.length > 0
      ? {
          context: `Recent activity before the error:\n${timelineLines.join("\n")}`,
        }
      : {}),
  };
}
