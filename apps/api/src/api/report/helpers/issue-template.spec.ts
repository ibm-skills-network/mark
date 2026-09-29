import {
  buildSnSupportTicketTitle,
  defaultSeverityForIssueType,
  stripSectionLabelMarkdown,
} from "./issue-template";

const baseInput = {
  issueType: "technical",
  assignmentId: 771,
  attemptId: 12_345,
  description: "Question 4 rejects my file upload with a client error 400.",
};

describe("buildSnSupportTicketTitle", () => {
  it("renders type and ids without any bracket prefixes", () => {
    const title = buildSnSupportTicketTitle(baseInput);

    expect(title).not.toContain("\n");
    expect(title).toContain("Assignment 771 - Attempt 12345");
    expect(title).not.toContain("[");
    expect(title).not.toContain("MARK CHAT");
    expect(title).not.toContain("PROD");
  });

  it("omits the attempt segment when attemptId is missing", () => {
    const title = buildSnSupportTicketTitle({
      ...baseInput,
      attemptId: undefined,
    });

    expect(title).toContain("Assignment 771:");
    expect(title).not.toContain("Attempt");
  });

  it("collapses whitespace in the description summary", () => {
    const title = buildSnSupportTicketTitle({
      ...baseInput,
      description: "line one\nline two\t\tspaced",
    });

    expect(title).not.toContain("\n");
    expect(title).toContain("line one line two spaced");
  });

  it("summarizes a form-templated description from the Actual result section", () => {
    const title = buildSnSupportTicketTitle({
      ...baseInput,
      description: [
        "**Steps to reproduce:**\n1. Open the quiz\n2. Submit",
        "**Expected result:**\nGrade appears",
        "**Actual result:**\nSpinner never stops",
        "**Environment (browser/device):**\nFirefox",
      ].join("\n\n"),
    });

    expect(title).toContain("Spinner never stops");
    expect(title).not.toContain("*");
    expect(title).not.toContain("Steps to reproduce");
  });

  it("inlines section labels when the template has no Actual result section", () => {
    const title = buildSnSupportTicketTitle({
      ...baseInput,
      description: "**What you're trying to do:**\nExport grades",
    });

    expect(title).toContain("What you're trying to do: Export grades");
    expect(title).not.toContain("*");
  });
});

describe("stripSectionLabelMarkdown", () => {
  it("drops bold markers around section labels but keeps plain text intact", () => {
    expect(
      stripSectionLabelMarkdown("**Steps to reproduce:**\n1. Open the quiz"),
    ).toBe("Steps to reproduce:\n1. Open the quiz");
    expect(stripSectionLabelMarkdown("plain description")).toBe(
      "plain description",
    );
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
