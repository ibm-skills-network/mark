import {
  expectedHostsForResponseType,
  GITHUB_EXPECTED_HOSTS,
  MAX_LEARNER_URL_LENGTH,
  normalizeLearnerUrl,
  validateLearnerUrl,
} from "./learner-url.util";

const BLOB_URL =
  "https://github.com/owner/expressBookReviews/blob/main/final_project/router/general.js";

/**
 * Kept byte-identical with the fixture list in
 * apps/web/lib/__tests__/url-response.test.ts. Both sides must agree on every
 * row: a disagreement is exactly the defect this helper exists to close — the
 * browser blocking an answer the grader accepts, or accepting one the grader
 * scores zero.
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

describe("learner URL normalization (shared with the web copy)", () => {
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

  it("keeps the blob path intact so raw-url conversion still matches", () => {
    const normalized = normalizeLearnerUrl(BLOB_URL.replace("https://", ""));
    expect(normalized).toContain("/blob/");
    expect(
      /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/.test(normalized),
    ).toBe(true);
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

  it("never returns a non-http(s) target for the fetch pipeline", () => {
    for (const scheme of ["ftp", "javascript", "data", "file"]) {
      expect(normalizeLearnerUrl(`${scheme}://example.com/x`)).toBe("");
    }
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
    expect(expectedHostsForResponseType(undefined)).toBeUndefined();
  });
});
