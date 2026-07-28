import { GithubRateLimitedError } from "src/api/llm/features/grading/errors/github-rate-limited.error";
import { safeGet } from "./ssrf-safe-http";
import { githubApiGet } from "./github-content-fetch.util";

jest.mock("./ssrf-safe-http", () => ({
  safeGet: jest.fn(),
}));

const mockedSafeGet = safeGet as jest.MockedFunction<typeof safeGet>;

function axiosError(status: number, headers: Record<string, string> = {}) {
  return {
    isAxiosError: true,
    message: `Request failed with status code ${status}`,
    response: { status, headers, data: {} },
  };
}

describe("githubApiGet", () => {
  const ORIGINAL_TOKEN = process.env.GITHUB_GRADING_API_TOKEN;

  afterEach(() => {
    if (ORIGINAL_TOKEN === undefined) {
      delete process.env.GITHUB_GRADING_API_TOKEN;
    } else {
      process.env.GITHUB_GRADING_API_TOKEN = ORIGINAL_TOKEN;
    }
  });

  it("attaches an Authorization header when a token is configured", async () => {
    process.env.GITHUB_GRADING_API_TOKEN = "test-token-value";
    mockedSafeGet.mockResolvedValue({
      data: { default_branch: "develop" },
      status: 200,
    } as any);

    await githubApiGet(
      "https://api.github.com/repos/octocat/hello-world",
      "octocat",
      "hello-world",
    );

    expect(mockedSafeGet).toHaveBeenCalledWith(
      "https://api.github.com/repos/octocat/hello-world",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token-value",
        }),
      }),
    );
  });

  it("omits the Authorization header when no token is configured", async () => {
    delete process.env.GITHUB_GRADING_API_TOKEN;
    mockedSafeGet.mockResolvedValue({
      data: { default_branch: "main" },
      status: 200,
    } as any);

    await githubApiGet(
      "https://api.github.com/repos/octocat/hello-world",
      "octocat",
      "hello-world",
    );

    const [, config] = mockedSafeGet.mock.calls[0];
    expect(config?.headers).not.toHaveProperty("Authorization");
  });

  it("throws GithubRateLimitedError on a 403 rate-limit response", async () => {
    mockedSafeGet.mockRejectedValue(
      axiosError(403, {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "1800000000",
      }),
    );

    await expect(
      githubApiGet(
        "https://api.github.com/repos/octocat/hello-world",
        "octocat",
        "hello-world",
      ),
    ).rejects.toThrow(GithubRateLimitedError);
  });

  it("rethrows the original error for a non-rate-limit failure (e.g. 404)", async () => {
    const notFound = axiosError(404);
    mockedSafeGet.mockRejectedValue(notFound);

    await expect(
      githubApiGet(
        "https://api.github.com/repos/octocat/does-not-exist",
        "octocat",
        "does-not-exist",
      ),
    ).rejects.toBe(notFound);
  });
});
