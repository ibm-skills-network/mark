import {
  buildGradingIssue,
  defaultIssueMessage,
  GRADING_ISSUE_CODES,
  isGradingFailure,
  summarizeGradingFailure,
} from "./grading-failure";
import { gradingFailureFromError } from "./grading-failure.mapper";
import {
  RetryableProcessingError,
  SourceProcessingError,
} from "./source-processing.error";

describe("grading issue payload", () => {
  it("has actionable English copy that names the source for every code", () => {
    for (const code of GRADING_ISSUE_CODES) {
      const urlMessage = defaultIssueMessage(
        code,
        { kind: "url", url: "https://github.com/o/r" },
        7,
      );
      const fileMessage = defaultIssueMessage(
        code,
        { kind: "file", fileName: "work.pdf", expectedType: "pdf" },
        7,
      );
      expect(urlMessage.length).toBeGreaterThan(40);
      expect(`${urlMessage} ${fileMessage}`).toMatch(
        /github\.com\/o\/r|work\.pdf|web address/,
      );
    }
  });

  it("rotates the catch-all wording deterministically by question", () => {
    const source = { kind: "file" as const, fileName: "a.bin" };
    const variants = new Set(
      [1, 2, 3].map((id) =>
        defaultIssueMessage("source_unreadable", source, id),
      ),
    );
    expect(variants.size).toBe(3);
    expect(defaultIssueMessage("source_unreadable", source, 4)).toBe(
      defaultIssueMessage("source_unreadable", source, 1),
    );
  });

  it("only marks the temporary-outage code retryable", () => {
    expect(
      buildGradingIssue(1, { code: "url_temporarily_unavailable" }).retryable,
    ).toBe(true);
    expect(buildGradingIssue(1, { code: "url_unreachable" }).retryable).toBe(
      false,
    );
  });

  it("strips credentials and bounds learner-supplied text", () => {
    const issue = buildGradingIssue(1, {
      code: "url_unreachable",
      source: {
        kind: "url",
        url: `https://user:ghp_secret@github.com/o/r/${"x".repeat(400)}`, // pragma: allowlist secret
      },
    });
    expect(issue.source?.url).not.toContain("ghp_secret");
    expect(issue.source?.url?.length).toBe(300);
    const file = buildGradingIssue(1, {
      code: "file_empty",
      source: { kind: "file", fileName: `/tmp/uploads/${"y".repeat(300)}.pdf` },
    });
    expect(file.source?.fileName).not.toContain("/tmp");
    expect(file.source?.fileName?.length).toBe(200);
  });

  it("keeps the summary for older clients short enough for progress", () => {
    const failure = {
      kind: "unable_to_grade" as const,
      issues: [
        buildGradingIssue(1, {
          code: "url_unreachable",
          source: { kind: "url", url: "https://github.com/o/r" },
        }),
        buildGradingIssue(2, {
          code: "file_empty",
          source: { kind: "file", fileName: "a.txt" },
        }),
      ],
    };
    expect(summarizeGradingFailure(failure)).toMatch(
      /^We couldn't grade 2 of your answers as submitted\. We couldn't open https:\/\/github\.com\/o\/r\./,
    );
    expect(isGradingFailure(failure)).toBe(true);
    const long = {
      kind: "unable_to_grade" as const,
      issues: [1, 2, 3].map((id) =>
        buildGradingIssue(id, {
          code: "url_unreachable",
          source: {
            kind: "url",
            url: `https://github.com/o/${"r".repeat(150)}`,
          },
        }),
      ),
    };
    const summary = summarizeGradingFailure(long);
    expect(summary.length).toBeLessThanOrEqual(255);
    expect(summary).toMatch(
      /^We couldn't grade 3 of your answers as submitted\. /,
    );
    expect(summary).toMatch(/\S…$/);
    expect(isGradingFailure({ kind: "unable_to_grade", issues: [{}] })).toBe(
      false,
    );
  });

  it("maps errors to a kind", () => {
    expect(
      gradingFailureFromError(
        new SourceProcessingError("url_fetch_failed", "url", {
          code: "url_placeholder",
          questionId: 3,
          source: { kind: "url", url: "https://github.com/<you>/r" },
        }),
      ),
    ).toEqual({
      kind: "unable_to_grade",
      issues: [
        expect.objectContaining({ questionId: 3, code: "url_placeholder" }),
      ],
    });
    expect(
      gradingFailureFromError(
        new RetryableProcessingError("grading_unavailable"),
      ),
    ).toEqual({
      kind: "grading_failed",
      issues: [],
    });
    expect(gradingFailureFromError(new Error("boom"))).toEqual({
      kind: "grading_failed",
      issues: [],
    });
  });
});
