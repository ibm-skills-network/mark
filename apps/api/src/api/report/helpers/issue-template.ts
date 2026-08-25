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

// Form-composed reports (flag button, error dialog) arrive with the
// description already templated into "**Label:**\ncontent" sections.
const SECTION_LABEL_PATTERN = /\*\*([^\n*]+):\*\*/g;
const ACTUAL_RESULT_PATTERN =
  /\*\*actual result:\*\*\s*([\S\s]*?)(?=\n\s*\*\*[^\n*]+:\*\*|$)/i;

/**
 * One-line summary of a report description for use in a title. For templated
 * descriptions, the "Actual result" section (the symptom) makes the best
 * summary; failing that, the section labels are inlined so the title carries
 * the reporter's own words instead of markdown markers. Plain descriptions
 * pass through unchanged apart from whitespace normalization.
 */
function summarizeDescription(description: string): string {
  const actualResult = ACTUAL_RESULT_PATTERN.exec(description);
  const source = actualResult
    ? actualResult[1]
    : description.replaceAll(SECTION_LABEL_PATTERN, "$1:");
  return source.replaceAll(/\s+/g, " ").trim();
}

/**
 * SN Support renders descriptions as plain text, so the markdown bold
 * markers around form-section labels would show as literal asterisks there.
 */
export function stripSectionLabelMarkdown(description: string): string {
  return description.replaceAll(SECTION_LABEL_PATTERN, "$1:").trim();
}

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
  const normalizedDescription = summarizeDescription(input.description);
  const summary = normalizedDescription.slice(0, TITLE_SUMMARY_MAX_CHARS);
  const ellipsis =
    normalizedDescription.length > TITLE_SUMMARY_MAX_CHARS ? "..." : "";
  const attemptSegment = input.attemptId ? ` - Attempt ${input.attemptId}` : "";

  return `[MARK CHAT] [${environment}] [${input.role}] ${input.severity.toUpperCase()} ${capitalizeIssueType(
    input.issueType,
  )} Assignment ${input.assignmentId || "N/A"}${attemptSegment}: ${summary}${ellipsis}`;
}

// SN Support tickets carry environment, role, and severity as structured
// fields, so the title stays human-readable without the bracket prefixes.
export function buildSnSupportTicketTitle(
  input: ChatIssueTemplateInput,
): string {
  const normalizedDescription = summarizeDescription(input.description);
  const summary = normalizedDescription.slice(0, TITLE_SUMMARY_MAX_CHARS);
  const ellipsis =
    normalizedDescription.length > TITLE_SUMMARY_MAX_CHARS ? "..." : "";
  const attemptSegment = input.attemptId ? ` - Attempt ${input.attemptId}` : "";

  return `${capitalizeIssueType(input.issueType)}: Assignment ${
    input.assignmentId || "N/A"
  }${attemptSegment}: ${summary}${ellipsis}`;
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
