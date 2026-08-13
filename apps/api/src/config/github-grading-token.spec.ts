import { getGithubGradingApiToken } from "./github-grading-token";

describe("getGithubGradingApiToken", () => {
  const ORIGINAL_ENV = process.env.GITHUB_GRADING_API_TOKEN;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.GITHUB_GRADING_API_TOKEN;
    } else {
      process.env.GITHUB_GRADING_API_TOKEN = ORIGINAL_ENV;
    }
  });

  it("returns undefined when the env var is unset", () => {
    delete process.env.GITHUB_GRADING_API_TOKEN;
    expect(getGithubGradingApiToken()).toBeUndefined();
  });

  it("returns undefined for an empty or whitespace-only value", () => {
    process.env.GITHUB_GRADING_API_TOKEN = "   ";
    expect(getGithubGradingApiToken()).toBeUndefined();
  });

  it("returns the trimmed token when set", () => {
    process.env.GITHUB_GRADING_API_TOKEN = "  ghp_example_token_value  ";
    expect(getGithubGradingApiToken()).toBe("ghp_example_token_value");
  });
});
