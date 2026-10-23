import {
  detectPrefetchUrlIssue,
  isCourseTemplateRepoUrl,
} from "./learner-url-issues.util";

describe("detectPrefetchUrlIssue", () => {
  it.each([
    "https://github.com/<your-github-username>/mcino-Introduction-to-Git-and-GitHub/blob/main/README.md",
    "https://github.com/%3Cyour-username%3E/repo",
    "https://github.com/YOUR-USERNAME/YOUR-REPO/blob/main/onlinecourse/models.py",
    "https://github.com/your-username/simple-interest-calculator",
    "https://github.com/username/repo",
    "https://example.com/my-project",
  ])("flags the placeholder in %s", (url) => {
    expect(detectPrefetchUrlIssue(url)?.code).toBe("url_placeholder");
  });

  it.each([
    "https://github.com/octocat/username-generator",
    "https://github.com/yourself/project",
    "https://github.com/o/r/blob/main/src/username.js",
    "https://github.com/Om/simple-interest-calculator/blob/main/README.md",
    "https://github.com/o/r/issues/12",
    "https://github.com/o/r/pull/3",
    "https://github.com/o/r/tree/main/projects",
    "https://myname.github.io/portfolio/",
  ])("leaves %s alone", (url) => {
    expect(detectPrefetchUrlIssue(url)).toBeUndefined();
  });
});

describe("isCourseTemplateRepoUrl", () => {
  it("recognises the course starter org, case-insensitively", () => {
    expect(
      isCourseTemplateRepoUrl(
        "https://github.com/IBM-Developer-Skills-Network/oaqjp-final-project-emb-ai/blob/main/__init__.py",
      ),
    ).toBe(true);
    expect(
      isCourseTemplateRepoUrl(
        "https://github.com/learner/oaqjp-final-project-emb-ai",
      ),
    ).toBe(false);
    expect(
      isCourseTemplateRepoUrl(
        "https://gitlab.com/ibm-developer-skills-network/x",
      ),
    ).toBe(false);
  });
});
