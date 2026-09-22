import {
  describeLearnerUrlProblem,
  expectedHostsForResponseType,
  GITHUB_EXPECTED_HOSTS,
  isLearnerUrlSubmittable,
  MAX_LEARNER_URL_LENGTH,
  normalizeLearnerUrl,
  validateLearnerUrl,
} from "@/lib/url-response";
import { editedQuestionsOnly, getSubmitButtonStatus } from "@/lib/utils";
import type { QuestionStore } from "@/config/types";

const BLOB_URL =
  "https://github.com/owner/expressBookReviews/blob/main/final_project/router/general.js";

/**
 * Kept byte-identical with the fixture list in
 * apps/api/src/api/attempt/common/utils/learner-url.util.spec.ts.
 * Both sides must agree on every row or the browser starts blocking answers
 * the grader would have accepted (or vice versa).
 */
const SHARED_FIXTURES: Array<[string, string, boolean]> = [
  ["plain https blob url", BLOB_URL, true],
  ["trailing space", `${BLOB_URL} `, true],
  ["leading space", `  ${BLOB_URL}`, true],
  ["trailing newline", `${BLOB_URL}\n`, true],
  ["schemeless github blob", BLOB_URL.replace("https://", ""), true],
  ["schemeless with www", "www.github.com/owner/repo", true],
  ["http scheme", "http://example.com/report.pdf", true],
  ["path with parentheses", "https://github.com/o/r/blob/main/R(v2).js", true],
  ["path with comma and at-sign", "https://example.com/a,b@c/d!e", true],
  ["query and fragment", "https://example.com/p?a=1&b=2#frag", true],
  ["host with underscore", "https://my_host.example.com/x", true],
  ["uppercase host", "HTTPS://GitHub.com/Owner/Repo", true],
  ["empty", "", false],
  ["whitespace only", "   ", false],
  ["bare word", "dgtj", false],
  ["bare filename", "general.js", false],
  ["bare filename with extension case", "Report.PDF", false],
  ["github pages host", "owner.github.io", true],
  ["mistyped scheme separator", "https;//github.com/owner/repo", false],
  [
    "markdown wrapped link",
    "[https://github.com/](https://github.com/)x",
    false,
  ],
  ["non-http scheme", "ftp://example.com/file.txt", false],
  ["javascript scheme", "javascript:alert(1)", false],
];

describe("learner URL normalization (shared with the API copy)", () => {
  it.each(SHARED_FIXTURES)("%s", (_label, input, expected) => {
    expect(validateLearnerUrl(input).isValid).toBe(expected);
  });

  it("trims surrounding whitespace instead of rejecting it", () => {
    expect(normalizeLearnerUrl(`  ${BLOB_URL}\n`)).toBe(BLOB_URL);
  });

  it("adds https:// to a schemeless github link", () => {
    expect(normalizeLearnerUrl(BLOB_URL.replace("https://", ""))).toBe(
      BLOB_URL,
    );
  });

  it("preserves the learner's own spelling apart from the added scheme", () => {
    expect(normalizeLearnerUrl("GitHub.com/Owner/Repo")).toBe(
      "https://GitHub.com/Owner/Repo",
    );
    expect(normalizeLearnerUrl("https://example.com")).toBe(
      "https://example.com",
    );
  });

  it("rejects a value longer than the DTO limit", () => {
    const long = `https://example.com/${"a".repeat(MAX_LEARNER_URL_LENGTH)}`;
    expect(validateLearnerUrl(long)).toMatchObject({
      isValid: false,
      rejection: "too_long",
    });
  });

  it("reports a non-http scheme separately from unparseable input", () => {
    expect(validateLearnerUrl("ftp://example.com/x").rejection).toBe(
      "unsupported_scheme",
    );
    expect(validateLearnerUrl("dgtj").rejection).toBe("unparseable");
  });

  it("flags an unexpected host without rejecting it", () => {
    const result = validateLearnerUrl("https://gitlab.com/owner/repo", {
      expectedHosts: GITHUB_EXPECTED_HOSTS,
    });
    expect(result.isValid).toBe(true);
    expect(result.isUnexpectedHost).toBe(true);
  });

  it("accepts a github subdomain against the expected-host list", () => {
    expect(
      validateLearnerUrl("https://raw.githubusercontent.com/o/r/main/a.js", {
        expectedHosts: GITHUB_EXPECTED_HOSTS,
      }).isUnexpectedHost,
    ).toBe(false);
  });

  it("only asks for github hosts on repository questions", () => {
    expect(expectedHostsForResponseType("REPO")).toBe(GITHUB_EXPECTED_HOSTS);
    expect(expectedHostsForResponseType("OTHER")).toBeUndefined();
    expect(expectedHostsForResponseType(null)).toBeUndefined();
  });

  it("returns learner-facing copy for each rejection", () => {
    expect(describeLearnerUrlProblem(validateLearnerUrl("dgtj"))).toMatch(
      /web address/i,
    );
    expect(
      describeLearnerUrlProblem(validateLearnerUrl("ftp://example.com")),
    ).toMatch(/http/i);
    expect(
      describeLearnerUrlProblem(validateLearnerUrl(BLOB_URL)),
    ).toBeUndefined();
  });

  it("exposes a predicate for call sites that only need the boolean", () => {
    expect(isLearnerUrlSubmittable(`${BLOB_URL} `)).toBe(true);
    expect(isLearnerUrlSubmittable("dgtj")).toBe(false);
  });
});

function urlQuestion(id: number, url: string): QuestionStore {
  return {
    id,
    learnerUrlResponse: url,
  } as unknown as QuestionStore;
}

describe("submit gating for URL answers", () => {
  it("does not block submission on a pasted trailing space", () => {
    const status = getSubmitButtonStatus(
      [urlQuestion(1, `${BLOB_URL} `)],
      false,
    );
    expect(status.disabled).toBe(false);
  });

  it("does not block submission on a schemeless github link", () => {
    const status = getSubmitButtonStatus(
      [urlQuestion(1, BLOB_URL.replace("https://", ""))],
      false,
    );
    expect(status.disabled).toBe(false);
  });

  it("does not block submission on a path containing parentheses", () => {
    const status = getSubmitButtonStatus(
      [urlQuestion(1, "https://github.com/o/r/blob/main/R(v2).js")],
      false,
    );
    expect(status.disabled).toBe(false);
  });

  it("still blocks a value that cannot become a URL, and names the question", () => {
    const status = getSubmitButtonStatus(
      [urlQuestion(1, BLOB_URL), urlQuestion(2, "dgtj")],
      false,
    );
    expect(status.disabled).toBe(true);
    expect(status.reason).toContain("2");
  });

  it("counts a URL answer as edited even when it does not parse", () => {
    const edited = editedQuestionsOnly([urlQuestion(1, "dgtj")]);
    expect(edited).toHaveLength(1);
  });
});
