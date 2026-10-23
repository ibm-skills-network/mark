import {
  cleanLearnerUrlText,
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
  ["repository path, not a host", ".github/ISSUE_TEMPLATE", false],
  ["host with an empty label", "github..com/owner/repo", false],
  ["github pages host", "owner.github.io", true],
  ["mistyped scheme separator", "https;//github.com/owner/repo", false],
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

describe("cleaning a pasted learner link", () => {
  // Real answers that previously reached the fetcher unchanged and failed.
  it.each([
    [
      "notes after the link",
      "https://github.com/Genith-Kokushibo/paradise-nursery/blob/main/src/App.jsx Grading Feedback",
      "https://github.com/Genith-Kokushibo/paradise-nursery/blob/main/src/App.jsx",
    ],
    [
      "label text after several spaces",
      "https://github.com/JACS002/IBM-fullstack_developer_capstone/blob/main/README.md    Repository Name: IBM-fullstack_developer_capstone  Project Name: CarConnect",
      "https://github.com/JACS002/IBM-fullstack_developer_capstone/blob/main/README.md",
    ],
    [
      "markdown link",
      "https://github.com/KSaiPrashanth/Car_Dealership_Full_Stack_App](https://github.com/KSaiPrashanth/Car_Dealership_Full_Stack_App",
      "https://github.com/KSaiPrashanth/Car_Dealership_Full_Stack_App",
    ],
    [
      "the same link pasted twice",
      "https://github.com/Zobrist02/java-database-capstone/blob/main/Dockerfilehttps://github.com/Zobrist02/java-database-capstone/blob/main/Dockerfile",
      "https://github.com/Zobrist02/java-database-capstone/blob/main/Dockerfile",
    ],
    [
      "the same link pasted twice after a slash",
      "https://github.com/o/r/https://github.com/o/r",
      "https://github.com/o/r/",
    ],
    [
      "a URL carried as a query value",
      "https://host.example/view?url=https://other.example/file",
      "https://host.example/view?url=https://other.example/file",
    ],
    [
      "a URL in a later query parameter",
      "https://host.example/view?a=1&next=https://other.example/x",
      "https://host.example/view?a=1&next=https://other.example/x",
    ],
    [
      "an archived page with the original URL in its path",
      "https://web.archive.org/web/2024/https://example.com/page",
      "https://web.archive.org/web/2024/https://example.com/page",
    ],
    [
      "word joiner copied with the link",
      "https://github.com/firstcontributions/first-contributions/blob/main/CONTRIBUTING.md\u2060",
      "https://github.com/firstcontributions/first-contributions/blob/main/CONTRIBUTING.md",
    ],
    [
      "zero-width space and BOM",
      "\uFEFFhttps://github.com/o/r/blob/main/a\u200B.py",
      "https://github.com/o/r/blob/main/a.py",
    ],
    [
      "tracking parameter from a chat assistant",
      "https://github.com/firstcontributions/first-contributions/blob/main/CONTRIBUTING.md?utm_source=chatgpt.com",
      "https://github.com/firstcontributions/first-contributions/blob/main/CONTRIBUTING.md",
    ],
    [
      "tracking parameter beside a real one",
      "https://example.com/page?id=7&utm_medium=x#top",
      "https://example.com/page?id=7#top",
    ],
    [
      "github editor link",
      "https://github.com/Hudaismai-l/django-course-project/edit/main/views.py",
      "https://github.com/Hudaismai-l/django-course-project/blob/main/views.py",
    ],
    [
      "colon and note glued to a repo link",
      "https://github.com/leonardoescobarvial-prog/oaqjp-final-project-emb-ai: final-project-emb-ai/blob/main/EmotionDetection/__init__.py",
      "https://github.com/leonardoescobarvial-prog/oaqjp-final-project-emb-ai",
    ],
    [
      "sentence punctuation",
      "My repo is https://github.com/o/r.",
      "https://github.com/o/r",
    ],
    [
      "link in parentheses",
      "(see https://github.com/o/r)",
      "https://github.com/o/r",
    ],
    [
      "balanced parentheses stay",
      "https://github.com/o/r/blob/main/R(v2).js",
      "https://github.com/o/r/blob/main/R(v2).js",
    ],
    [
      "angle-bracket wrapper",
      "<https://github.com/o/r>",
      "https://github.com/o/r",
    ],
    [
      "placeholder brackets are kept for detection",
      "https://github.com/<your-username>/<your-repo-name>",
      "https://github.com/<your-username>/<your-repo-name>",
    ],
  ])("%s", (_label, input, expected) => {
    expect(normalizeLearnerUrl(input)).toBe(expected);
    expect(cleanLearnerUrlText(input)).toBe(expected);
  });

  it("leaves schemeless text to the schemeless rules", () => {
    expect(cleanLearnerUrlText("  github.com/o/r  ")).toBe("github.com/o/r");
    expect(normalizeLearnerUrl("dgtj")).toBe("");
  });

  it("accepts a markdown-wrapped link by reading the first URL", () => {
    expect(
      validateLearnerUrl("[https://github.com/o/r](https://github.com/o/r)"),
    ).toMatchObject({ isValid: true, normalizedUrl: "https://github.com/o/r" });
  });
});
