import {
  buildChatIssueBody,
  buildChatIssueTitle,
  CHAT_ISSUE_FOOTER,
  defaultSeverityForIssueType,
} from "./issue-template";

const baseInput = {
  issueType: "technical",
  role: "learner",
  severity: "error",
  userEmail: "learner@example.com",
  assignmentId: 771,
  attemptId: 12_345,
  reportedAt: new Date("2026-05-14T10:33:26.841Z"),
  isProduction: true,
  description: "Question 4 rejects my file upload with a client error 400.",
};

describe("buildChatIssueTitle", () => {
  it("renders a single-line title with environment, role, severity and ids", () => {
    const title = buildChatIssueTitle(baseInput);

    expect(title).not.toContain("\n");
    expect(title).toContain("[MARK CHAT]");
    expect(title).toContain("[PROD]");
    expect(title).toContain("[learner]");
    expect(title).toContain("ERROR");
    expect(title).toContain("Assignment 771");
    expect(title).toContain("Attempt 12345");
  });

  it("omits the attempt segment when attemptId is missing", () => {
    const title = buildChatIssueTitle({ ...baseInput, attemptId: undefined });

    expect(title).not.toContain("Attempt");
    expect(title).not.toContain("undefined");
  });

  it("collapses whitespace in the description summary", () => {
    const title = buildChatIssueTitle({
      ...baseInput,
      description: "line one\nline two\t\tspaced",
    });

    expect(title).not.toContain("\n");
    expect(title).toContain("line one line two spaced");
  });

  it("marks non-production reports as DEV", () => {
    const title = buildChatIssueTitle({ ...baseInput, isProduction: false });

    expect(title).toContain("[DEV]");
  });
});

describe("buildChatIssueBody", () => {
  it("renders the standard Mark Chat issue template", () => {
    const body = buildChatIssueBody(baseInput);

    expect(body).toContain("## Issue Report from Mark Chat");
    expect(body).toContain("**Issue Type:** technical");
    expect(body).toContain("**Reported By:** learner");
    expect(body).toContain("**User Email:** learner@example.com");
    expect(body).toContain("**Assignment ID:** 771");
    expect(body).toContain("**Attempt ID:** 12345");
    expect(body).toContain("**Time Reported:** 2026-05-14T10:33:26.841Z");
    expect(body).toContain("**Severity:** error");
    expect(body).toContain("**Environment:** Production");
    expect(body).toContain("### Description");
    expect(body).toContain(baseInput.description);
  });

  it("falls back to placeholders for missing optional fields", () => {
    const body = buildChatIssueBody({
      ...baseInput,
      userEmail: undefined,
      assignmentId: undefined,
      attemptId: undefined,
      isProduction: false,
    });

    expect(body).toContain("**User Email:** Unknown");
    expect(body).toContain("**Assignment ID:** N/A");
    expect(body).toContain("**Attempt ID:** N/A");
    expect(body).toContain("**Environment:** Development");
  });
});

describe("defaultSeverityForIssueType", () => {
  it.each([
    ["bug", "error"],
    ["BUG", "error"],
    ["technical", "error"],
    ["critical", "critical"],
    ["grading", "warning"],
    ["FALSE_MARKING", "warning"],
    ["feedback", "info"],
    ["OTHER", "info"],
  ])("maps %s to %s", (issueType, expected) => {
    expect(defaultSeverityForIssueType(issueType)).toBe(expected);
  });
});

describe("CHAT_ISSUE_FOOTER", () => {
  it("carries the automated-report attribution line", () => {
    expect(CHAT_ISSUE_FOOTER).toContain(
      "This issue was automatically reported through the Mark Chat feature.",
    );
  });
});
