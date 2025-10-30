/* eslint-disable */
import { getBaseApiPath } from "@/config/constants";
import { IssueSeverity } from "@/config/types";
import { BASE_API_ROUTES } from "@/lib/talkToBackend";

export interface IssueReportDetails {
  issueType: string;
  assignmentId?: number;
  attemptId?: number;
  userRole?: "author" | "learner" | "system";
  severity?: IssueSeverity;
  category?: string;
  [key: string]: any;
}

interface ReportResponse {
  success: boolean;
  content: string;
  issueId?: string | number;
  issueNumber?: number;
  reportId?: number;
  error?: string;
}

/**
 * Service for handling reporting operations
 */
export class ReportingService {
  /**
   * Reports an issue to the backend
   *
   * @param title - The title of the issue
   * @param description - Detailed description of the issue
   * @param details - Additional details for the report
   * @returns A response object with information about the report
   */
  static async reportIssue(
    title: string,
    description: string,
    details: IssueReportDetails,
    cookieHeader?: string,
  ): Promise<ReportResponse> {
    try {
      const payload = {
        issueType: details.issueType || "technical",
        description,
        assignmentId: details.assignmentId,
        attemptId: details.attemptId,
        role: details.userRole || "system",
        severity: details.severity || "info",
        category: details.category || "General Issue",
        ...details,
      };

      const response = await fetch(`${getBaseApiPath("v1")}/reports`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      console.dir(response, {
        depth: 2,
        colors: true,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        const errorMessage =
          errorData?.message || `HTTP error ${response.status}`;

        if (response.status === 429) {
          throw new Error(errorMessage);
        }

        throw new Error(errorMessage);
      }

      const data = await response.json();

      return {
        success: true,
        content:
          data.message ||
          `Thank you for reporting this issue. Our team will review it shortly.`,
        issueNumber: data.issueNumber,
        reportId: data.reportId,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (
        errorMessage.includes("too many issues") ||
        errorMessage.includes("24 hours")
      ) {
        return {
          success: false,
          content: errorMessage,
          error: errorMessage,
        };
      }

      return {
        success: false,
        content: `There was an error submitting your issue report, but we've recorded it locally. Please try again later.`,
        error: errorMessage,
      };
    }
  }

  /**
   * Logs an error without sending it to the backend
   * Useful for client-side error tracking when the API might be unavailable
   *
   * @param error - The error object or message
   * @param context - Additional context about where the error occurred
   */
  static logError(error: Error | string, context: string): void {
    const errorMessage = error instanceof Error ? error.message : error;
    const errorStack = error instanceof Error ? error.stack : undefined;

    if (errorStack) {
    }

    try {
      const errorLogs = JSON.parse(
        localStorage.getItem("mark_error_logs") || "[]",
      );
      errorLogs.push({
        timestamp: new Date().toISOString(),
        context,
        message: errorMessage,
        stack: errorStack,
      });

      if (errorLogs.length > 50) {
        errorLogs.shift();
      }

      localStorage.setItem("mark_error_logs", JSON.stringify(errorLogs));
    } catch (e) {}
  }
}
