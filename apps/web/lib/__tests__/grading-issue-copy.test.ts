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
          source: { kind: "url", url: "https://x.test/a", httpStatus: 500 },
        }),
        t,
        en,
      ),
    ).toContain("error 500");
  });

  describe("link failures on sites other than GitHub", () => {
    const JOB_POST = "https://www.theladders.com/job/project-manager_86061933";
    const describeLink = (code: string, httpStatus?: number) =>
      describeGradingIssue(
        issue({ code, source: { kind: "url", url: JOB_POST, httpStatus } }),
        t,
        en,
      );

    it.each([
      ["url_blocked", 403],
      ["url_blocked", 401],
      ["url_unreachable", 404],
      ["url_unreachable", 410],
      ["url_unreachable", 500],
      ["url_unreachable", undefined],
      ["url_empty", 200],
      ["url_temporarily_unavailable", 429],
      ["url_temporarily_unavailable", 503],
    ])(
      "%s with status %s gives no GitHub or repository advice",
      (code, status) => {
        expect(describeLink(code, status)).not.toMatch(
          /github|repositor|committed/i,
        );
      },
    );

    it("says the site blocks automated tools when it refuses us", () => {
      const text = describeLink("url_blocked", 403);
      expect(text).toContain("blocks automated tools");
      expect(text).toContain("may open fine in your browser");
    });

    it("gives the same advice when the refusal arrives as url_unreachable", () => {
      expect(describeLink("url_unreachable", 403)).toBe(
        describeLink("url_blocked", 403),
      );
    });

    it("says a sign-in is needed on a 401", () => {
      expect(describeLink("url_blocked", 401)).toContain("sign-in");
    });

    it.each([404, 410])("says the page is gone on a %i", (status) => {
      const text = describeLink("url_unreachable", status);
      expect(text).toContain("doesn't exist or has been removed");
      expect(text).toContain("whole address");
    });

    it("names the status for any other error answer", () => {
      expect(describeLink("url_unreachable", 500)).toContain("error 500");
    });

    it("suspects the address when the site never answered", () => {
      expect(describeLink("url_unreachable")).toContain("typos");
    });

    it("says the page had nothing readable when it loads only in a browser", () => {
      expect(describeLink("url_empty", 200)).toContain("sign-in");
    });

    it("says the site is limiting requests on a 429, and offers a way out", () => {
      const text = describeLink("url_temporarily_unavailable", 429);
      expect(text).toContain("limiting how many requests");
      expect(text).toContain("different public link");
    });
  });

  it("keeps the repository advice for GitHub links", () => {
    const describeGithub = (code: string, httpStatus?: number) =>
      describeGradingIssue(
        issue({
          code,
          source: {
            kind: "url",
            url: "https://github.com/me/private",
            httpStatus,
          },
        }),
        t,
        en,
      );

    expect(describeGithub("url_unreachable", 404)).toContain(
      "If the repository is private",
    );
    expect(describeGithub("url_empty", 200)).toContain("committed");
  });

  it("does not mistake a lookalike host for GitHub", () => {
    expect(
      describeGradingIssue(
        issue({
          code: "url_unreachable",
          source: { kind: "url", url: "https://notgithub.com/me/repo" },
        }),
        t,
        en,
      ),
    ).not.toMatch(/repository/);
  });

  it("gives no repository advice when the link is unknown", () => {
    for (const code of ["url_unreachable", "url_blocked", "url_empty"]) {
      expect(describeGradingIssue(issue({ code }), t, en)).not.toMatch(
        /github|repositor|committed/i,
      );
    }
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
