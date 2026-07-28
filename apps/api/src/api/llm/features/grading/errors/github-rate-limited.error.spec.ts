import { LearnerFacingGradingError } from "./learner-facing-grading.error";
import { GithubRateLimitedError } from "./github-rate-limited.error";

describe("GithubRateLimitedError", () => {
  it("carries owner/repo/requestUrl/resetAt/retryAfterSeconds as own properties", () => {
    const error = new GithubRateLimitedError({
      owner: "octocat",
      repo: "hello-world",
      requestUrl: "https://api.github.com/repos/octocat/hello-world",
      resetAt: 1_800_000_000,
      retryAfterSeconds: 30,
    });

    expect(error.name).toBe("GithubRateLimitedError");
    expect(error.owner).toBe("octocat");
    expect(error.repo).toBe("hello-world");
    expect(error.requestUrl).toBe(
      "https://api.github.com/repos/octocat/hello-world",
    );
    expect(error.resetAt).toBe(1_800_000_000);
    expect(error.retryAfterSeconds).toBe(30);
    expect(error.message).toContain("octocat/hello-world");
  });

  it("is a retryable system error, not a learner-facing terminal one", () => {
    const error = new GithubRateLimitedError({
      owner: "a",
      repo: "b",
      requestUrl: "https://api.github.com/repos/a/b",
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(LearnerFacingGradingError);
  });

  it("omits optional fields cleanly when not provided", () => {
    const error = new GithubRateLimitedError({
      owner: "a",
      repo: "b",
      requestUrl: "https://api.github.com/repos/a/b",
    });

    expect(error.resetAt).toBeUndefined();
    expect(error.retryAfterSeconds).toBeUndefined();
  });
});
