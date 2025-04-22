/* eslint-disable */

import { BASE_API_ROUTES } from "@/config/constants";
import { IssueSeverity } from "@/config/types";

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
  message: string;
  issueId?: string | number;
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
  ): Promise<ReportResponse> {
    try {
      // Create the payload
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

      // Make the API call to the reports endpoint
      const response = await fetch(BASE_API_ROUTES.reports, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        // If response is not OK, try to get the error message
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.message || `HTTP error ${response.status}`);
      }

      // Parse the successful response
      const data = await response.json();

      return {
        success: true,
        message:
          data.message ||
          `Thank you for reporting this issue. Our team will review it shortly.`,
        issueId: data.id,
      };
    } catch (error) {
      console.error("Error reporting issue:", error);

      // Even if the API call fails, we want to give a decent user experience
      return {
        success: false,
        message: `There was an error submitting your issue report, but we've recorded it locally. Please try again later.`,
        error: error.message,
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

    console.error(`[ERROR] ${context}: ${errorMessage}`);
    if (errorStack) {
      console.error(errorStack);
    }

    // Could add local storage logging here if needed
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

      // Keep only the last 50 errors
      if (errorLogs.length > 50) {
        errorLogs.shift();
      }

      localStorage.setItem("mark_error_logs", JSON.stringify(errorLogs));
    } catch (e) {
      // Silently fail if localStorage isn't available
    }
  }
}
