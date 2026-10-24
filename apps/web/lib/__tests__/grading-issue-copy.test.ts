/**
 * @jest-environment node
 */

import { interpolate } from "@/hooks/use-ui-translation";
import {
  GRADING_ISSUE_CODES,
  parseGradingFailure,
  type GradingIssue,
} from "@/lib/grading-failure";
import {
  CATCH_ALL_MESSAGES,
  describeGradingIssue,
  safeHttpUrl,
  truncateMiddle,
} from "@/lib/grading-issue-copy";

const t = (source: string, params?: Record<string, string | number>) =>
  interpolate(source, params);
const en = { isEnglish: true };

const issue = (overrides: Partial<GradingIssue>): GradingIssue => ({
  questionId: 7,
  code: "source_unreadable",
  retryable: false,
  message: "Server fallback message.",
  ...overrides,
});

describe("describeGradingIssue", () => {
  it.each(GRADING_ISSUE_CODES.filter((code) => code !== "source_unreadable"))(
    "has its own copy for %s, with and without a source",
    (code) => {
      const bare = describeGradingIssue(issue({ code }), t, en);
      const withSource = describeGradingIssue(
        issue({
          code,
          source: {
            kind: code.startsWith("url") ? "url" : "file",
            url: "https://github.com/me/repo",
            fileName: "report.pdf",
          },
        }),
        t,
        en,
      );

      for (const text of [bare, withSource]) {
        expect(text).not.toBe("Server fallback message.");
        expect(CATCH_ALL_MESSAGES).not.toContain(text);
        expect(text).not.toMatch(/\{\w+\}/);
      }
      expect(withSource).toMatch(
        code.startsWith("url") ? /github\.com\/me\/repo/ : /report\.pdf/,
      );
    },
  );

  it("tells a learner with a dead or private link to make it public", () => {
    expect(
      describeGradingIssue(
        issue({
          code: "url_unreachable",
          source: { kind: "url", url: "https://github.com/me/private" },
        }),
        t,
        en,
      ),
    ).toBe(
      "We couldn't open your link (https://github.com/me/private). If the repository is private, make it public so it can be graded, then check the address is right.",
    );
  });

  it("includes the HTTP status when the site returned one", () => {
    expect(
      describeGradingIssue(
        issue({
          code: "url_unreachable",
          source: { kind: "url", url: "https://x.test/a", httpStatus: 404 },
        }),
        t,
        en,
      ),
    ).toContain("error 404");
  });

  it("explains a spreadsheet that is really a web page", () => {
    expect(
      describeGradingIssue(
        issue({
          code: "file_wrong_format",
          source: {
            kind: "file",
            fileName: "budget.xlsx",
            detectedType: "html",
            expectedType: "xlsx",
          },
        }),
        t,
        en,
      ),
    ).toBe(
      "We couldn't read budget.xlsx: it's a web page saved with a .xlsx name. Open it in Excel or Google Sheets and download it as a real .xlsx file.",
    );
  });

  it("names both types when the contents are another format", () => {
    expect(
      describeGradingIssue(
        issue({
          code: "file_wrong_format",
          source: {
            kind: "file",
            fileName: "a.docx",
            detectedType: "pdf",
            expectedType: "docx",
          },
        }),
        t,
        en,
      ),
    ).toContain("it's really a pdf file, not a .docx file");
  });

  it("uses the translator for known codes", () => {
    const translate = jest.fn(() => "TRADUIT");
    expect(
      describeGradingIssue(issue({ code: "file_encrypted" }), translate, en),
    ).toBe("TRADUIT");
    expect(translate).toHaveBeenCalledWith(
      "Your file is password-protected, so we can't read it. Remove the password and upload it again.",
      undefined,
    );
  });

  it("falls back to the server message for a code this client doesn't know", () => {
    expect(describeGradingIssue(issue({ code: "brand_new_code" }), t, en)).toBe(
      "Server fallback message.",
    );
  });

  it("falls back to a catch-all when an unknown code has no message", () => {
    const text = describeGradingIssue(
      issue({ code: "brand_new_code", message: "" }),
      t,
      en,
    );
    expect(CATCH_ALL_MESSAGES).toContain(text);
  });

  it("shows the server's advice for the catch-all code in English, and a localized catch-all otherwise", () => {
    expect(describeGradingIssue(issue({}), t, en)).toBe(
      "Server fallback message.",
    );
    expect(CATCH_ALL_MESSAGES).toContain(
      describeGradingIssue(issue({}), t, { isEnglish: false }),
    );
  });

  it("picks catch-all variants deterministically by question id", () => {
    const pick = (questionId: number) =>
      describeGradingIssue(
        issue({ questionId, code: "zzz", message: "" }),
        t,
        en,
      );
    expect(pick(5)).toBe(pick(5));
    const variants = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(pick));
    expect(variants.size).toBe(CATCH_ALL_MESSAGES.length);
  });

  it("truncates long learner values in the copy", () => {
    const longUrl = `https://github.com/${"a".repeat(250)}/repo`;
    const text = describeGradingIssue(
      issue({ code: "url_empty", source: { kind: "url", url: longUrl } }),
      t,
      en,
    );
    expect(text).not.toContain(longUrl);
    expect(text).toContain("…");
  });
});

describe("truncateMiddle", () => {
  it("leaves short values alone and keeps both ends of long ones", () => {
    expect(truncateMiddle("short.pdf")).toBe("short.pdf");
    const cut = truncateMiddle(`${"x".repeat(100)}.ipynb`, 20);
    expect(cut).toHaveLength(20);
    expect(cut.endsWith(".ipynb")).toBe(true);
  });
});

describe("safeHttpUrl", () => {
  it("allows only http(s) links", () => {
    expect(safeHttpUrl("https://github.com/a")).toBe("https://github.com/a");
    expect(safeHttpUrl("http://x.test/")).toBe("http://x.test/");
    expect(safeHttpUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeHttpUrl("data:text/html,hi")).toBeUndefined();
    expect(safeHttpUrl("not a url")).toBeUndefined();
    expect(safeHttpUrl(undefined)).toBeUndefined();
  });
});

describe("parseGradingFailure", () => {
  it("keeps a valid learner-fixable failure", () => {
    expect(
      parseGradingFailure({
        kind: "unable_to_grade",
        issues: [
          {
            questionId: 3,
            code: "file_empty",
            retryable: false,
            message: "Empty.",
            source: { kind: "file", fileName: "a.txt" },
          },
        ],
      }),
    ).toEqual({
      kind: "unable_to_grade",
      issues: [
        {
          questionId: 3,
          code: "file_empty",
          retryable: false,
          message: "Empty.",
          source: { kind: "file", fileName: "a.txt" },
        },
      ],
    });
  });

  it("drops malformed issues and bounds learner-supplied fields", () => {
    const parsed = parseGradingFailure({
      kind: "unable_to_grade",
      issues: [
        { questionId: -1, code: "file_empty" },
        { questionId: 2, code: 5 },
        {
          questionId: 4,
          code: "file_wrong_format",
          retryable: "yes",
          source: {
            kind: "file",
            fileName: "f".repeat(500),
            url: "u".repeat(500),
            httpStatus: 9999,
            detectedType: "<b>HTML</b>",
            expectedType: ".XLSX",
          },
        },
      ],
    });
    expect(parsed?.issues).toHaveLength(1);
    const [only] = parsed?.issues ?? [];
    expect(only.retryable).toBe(false);
    expect(only.message).toBe("");
    expect(only.source?.fileName).toHaveLength(200);
    expect(only.source?.url).toHaveLength(300);
    expect(only.source?.httpStatus).toBeUndefined();
    expect(only.source?.detectedType).toBe("bhtmlb");
    expect(only.source?.expectedType).toBe("xlsx");
  });

  it.each([
    undefined,
    null,
    "unable_to_grade",
    { kind: "other", issues: [] },
    { kind: "unable_to_grade", issues: [] },
    { kind: "unable_to_grade", issues: "nope" },
  ])("rejects %p", (value) => {
    expect(parseGradingFailure(value)).toBeUndefined();
  });

  it("accepts grading_failed without issues", () => {
    expect(parseGradingFailure({ kind: "grading_failed" })).toEqual({
      kind: "grading_failed",
      issues: [],
    });
  });
});
