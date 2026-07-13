export interface ChatIssueTemplateInput {
  issueType: string;
  role: string;
  severity: string;
  userEmail?: string | null;
  assignmentId?: number | null;
  attemptId?: number | null;
  reportedAt: Date;
  isProduction: boolean;
  description: string;
}

export const CHAT_ISSUE_FOOTER = `\n---\n*This issue was automatically reported through the Mark Chat feature.*`;

const TITLE_SUMMARY_MAX_CHARS = 50;

function capitalizeIssueType(issueType: string): string {
  if (!issueType) return "Unknown";
  return issueType.charAt(0).toUpperCase() + issueType.slice(1).toLowerCase();
}

/**
 * Default severity when the reporter didn't pick one. Accepts both the raw
 * chat issue types ("technical", "grading", ...) and ReportType enum values
 * ("BUG", "FALSE_MARKING", ...).
 */
export function defaultSeverityForIssueType(
  issueType: string,
): "info" | "warning" | "error" | "critical" {
  switch ((issueType || "").toLowerCase()) {
    case "bug":
    case "technical": {
      return "error";
    }
    case "critical": {
      return "critical";
    }
    case "grading":
    case "false_marking":
    case "false marking": {
      return "warning";
    }
    default: {
      return "info";
    }
  }
}

export function buildChatIssueTitle(input: ChatIssueTemplateInput): string {
  const environment = input.isProduction ? "PROD" : "DEV";
  const normalizedDescription = input.description
    .replaceAll(/\s+/g, " ")
    .trim();
  const summary = normalizedDescription.slice(0, TITLE_SUMMARY_MAX_CHARS);
  const ellipsis =
    normalizedDescription.length > TITLE_SUMMARY_MAX_CHARS ? "..." : "";
  const attemptSegment = input.attemptId ? ` - Attempt ${input.attemptId}` : "";

  return `[MARK CHAT] [${environment}] [${input.role}] ${input.severity.toUpperCase()} ${capitalizeIssueType(
    input.issueType,
  )} Assignment ${input.assignmentId || "N/A"}${attemptSegment}: ${summary}${ellipsis}`;
}

export function buildChatIssueBody(input: ChatIssueTemplateInput): string {
  return `
## Issue Report from Mark Chat

**Issue Type:** ${input.issueType}
**Reported By:** ${input.role || "Unknown"}
**User Email:** ${input.userEmail || "Unknown"}
**Assignment ID:** ${input.assignmentId || "N/A"}
**Attempt ID:** ${input.attemptId || "N/A"}
**Time Reported:** ${input.reportedAt.toISOString()}
**Severity:** ${input.severity}
**Environment:** ${input.isProduction ? "Production" : "Development"}

### Description
${input.description}
`;
}
