import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { ReportIssueDto } from "../types/report.types";
import { FloService } from "./flo.service";

@Injectable()
export class ReportsService {
  constructor(
    private readonly floService: FloService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Create a GitHub issue in the configured repository using direct API calls via axios
   */
  private async createGithubIssue(
    title: string,
    body: string,
    labels: string[] = [],
  ): Promise<{ number: number; [key: string]: any }> {
    // Validate environment variables
    const githubOwner = this.configService.get<string>("ibm-skills-network");
    const githubRepo = this.configService.get<string>("mark");
    const token = this.configService.get<string>("GITHUB_APP_TOKEN");
    if (!githubOwner || !githubRepo || !token) {
      throw new InternalServerErrorException(
        "GitHub repository configuration or token missing",
      );
    }

    try {
      const response = await axios.post(
        `https://api.github.com/repos/${githubOwner}/${githubRepo}/issues`,
        {
          title,
          body,
          labels,
        },
        {
          headers: {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github.v3+json",
          },
        },
      );

      return response.data as { number: number; [key: string]: any };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          "Error creating GitHub issue:",
          error.response?.data || error.message,
        );
        throw new InternalServerErrorException(
          `Failed to create GitHub issue: ${error.message}`,
        );
      } else {
        console.error("Error creating GitHub issue:", error);
        throw new InternalServerErrorException(
          `Failed to create GitHub issue: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
      }
    }
  }

  /**
   * Report an issue from the Mark chat
   */
  async reportIssue(
    dto: ReportIssueDto,
  ): Promise<{ message: string; issueNumber?: number }> {
    const { issueType, description, assignmentId, attemptId, role, severity } =
      dto;
    if (!issueType) {
      throw new InternalServerErrorException("issueType is required");
    }
    // Map issue type to severity if not provided
    let issueSeverity: "info" | "warning" | "error" | "critical" =
      severity || "info";
    if (!severity) {
      if (issueType === "technical") issueSeverity = "error";
      if (issueType === "bug") issueSeverity = "error";
      if (issueType === "critical") issueSeverity = "critical";
      if (issueType === "grading") issueSeverity = "warning";
    }

    // Format the issue title
    const issueTitle = `[${role?.toUpperCase() || "USER"}] ${
      issueType.charAt(0).toUpperCase() + issueType.slice(1)
    } Issue Report`;

    // Format the issue body with detailed information
    const issueBody = `
## Issue Report from Mark Chat

**Issue Type:** ${issueType}
**Reported By:** ${role || "Unknown"}
**Assignment ID:** ${assignmentId || "N/A"}
**Attempt ID:** ${attemptId || "N/A"}
**Time Reported:** ${new Date().toISOString()}

### Description
${description}

---
*This issue was automatically reported through the Mark Chat feature.*
`;

    try {
      const labels = ["chat-report"];
      if (issueType === "technical" || issueType === "bug") labels.push("bug");
      if (issueType === "content") labels.push("content");
      if (issueType === "grading") labels.push("grading");
      if (role) labels.push(role);

      const issue = await this.createGithubIssue(issueTitle, issueBody, labels);

      // Optionally, report to Flo if needed (code commented out below)
      // await this.floService.sendError(issueTitle, description, {
      //   severity: issueSeverity,
      //   tags: ["mark", "chat", "report", role || "user", issueType],
      //   assignmentId,
      //   attemptId,
      //   github_issue: issue.number,
      // });

      return {
        message: `Thank you for your report. Issue #${issue.number} has been created and our team will review it soon.`,
        issueNumber: issue?.number,
      };
    } catch (error) {
      console.error("Error reporting issue:", error);
      return {
        message:
          "We encountered an issue while submitting your report. Your feedback is still important to us - please try again later.",
      };
    }
  }
  /**
   * Handle a regrade request and report to Flo
   */
  // async handleRegradeRequest(
  //   assignmentId: number,
  //   attemptId: number,
  //   reason: string,
  //   userEmail?: string,
  //   role?: "author" | "learner",
  // ): Promise<{ message: string }> {
  // try {
  //   // Send to Flo
  //   await this.floService.sendSupportRequest(
  //     `[MARK CHAT] Regrading Request`,
  //     reason,
  //     {
  //       category: "Grading Issue",
  //       assignmentId,
  //       attemptId,
  //       userEmail,
  //       user_role: role || "learner",
  //     }
  //   );

  //   return {
  //     message: `Your regrading request for assignment ${assignmentId} has been submitted successfully. Our team will review it soon.`,
  //   };
  // } catch (error) {
  //   console.error("Error handling regrade request:", error);
  //   return {
  //     message:
  //       "We encountered an issue while submitting your regrade request. Please try again later.",
  //   };
  // }
  //   return {
  //     message: `Your regrading request for assignment ${assignmentId} has been submitted successfully. Our team will review it soon.`,
  //   };
  // }

  /**
   * Send user feedback about the platform to Flo
   */
  async sendUserFeedback(
    title: string,
    description: string,
    rating: string,
    userEmail?: string,
    portalName?: string,
  ): Promise<{ message: string }> {
    try {
      // await this.floService.sendFeedback(title, description, {
      //   rating,
      //   userEmail,
      //   portalName: portalName || "Mark AI Assistant",
      // });
      // send feedback through gituhub
      const issueTitle = `[MARK CHAT] User Feedback: ${title}`;
      const issueBody = `
## User Feedback Report
**Feedback Type:** ${title}
**Rating:** ${rating}
**Reported By:** ${userEmail || "Anonymous"}
**Time Reported:** ${new Date().toISOString()}
### Description
${description}
---
*This feedback was automatically reported through the Mark Chat feature.*
`;

      const labels = ["feedback"];
      if (title === "bug") labels.push("bug");
      if (title === "content") labels.push("content");
      if (title === "grading") labels.push("grading");
      if (title === "technical") labels.push("technical");
      if (title === "critical") labels.push("critical");
      if (title === "feature") labels.push("feature");
      if (title === "other") labels.push("other");

      const issue = await this.createGithubIssue(issueTitle, issueBody, labels);
      return {
        message: `Thank you for your feedback! Issue #${issue.number} has been created and our team will review it soon.`,
      };
    } catch (error) {
      console.error("Error sending user feedback:", error);
      return {
        message:
          "We encountered an issue while submitting your feedback. Please try again later.",
      };
    }
  }
}
