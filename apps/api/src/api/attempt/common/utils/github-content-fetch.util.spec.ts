import { Logger } from "@nestjs/common";
import { GithubRateLimitedError } from "src/api/llm/features/grading/errors/github-rate-limited.error";
import { safeGet } from "./ssrf-safe-http";
import {
  convertGitHubUrlToRaw,
  fetchReadmeForBranch,
  githubApiGet,
  resolveGithubDefaultBranch,
} from "./github-content-fetch.util";

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

  it("throws for a non-api.github.com host and never reaches safeGet", async () => {
    await expect(
      githubApiGet(
        "https://evil.example.com/repos/octocat/hello-world",
        "octocat",
        "hello-world",
      ),
    ).rejects.toThrow("githubApiGet requires an api.github.com URL");
    expect(mockedSafeGet).not.toHaveBeenCalled();
  });

  it("never attaches the token off-host when the host guard rejects the URL", async () => {
    process.env.GITHUB_GRADING_API_TOKEN = "test-token-value";

    await expect(
      githubApiGet(
        "https://evil.example.com/repos/octocat/hello-world",
        "octocat",
        "hello-world",
      ),
    ).rejects.toThrow("githubApiGet requires an api.github.com URL");
    expect(mockedSafeGet).not.toHaveBeenCalled();
  });
});

describe("resolveGithubDefaultBranch", () => {
  it("returns the repo's actual default_branch on success", async () => {
    mockedSafeGet.mockResolvedValue({
      data: { default_branch: "develop" },
      status: 200,
    } as any);

    const branch = await resolveGithubDefaultBranch("octocat", "hello-world");

    expect(branch).toBe("develop");
    expect(mockedSafeGet).toHaveBeenCalledWith(
      "https://api.github.com/repos/octocat/hello-world",
      expect.anything(),
    );
  });

  it("returns undefined (does not throw) on a non-rate-limit failure", async () => {
    mockedSafeGet.mockRejectedValue(axiosError(404));

    await expect(
      resolveGithubDefaultBranch("octocat", "does-not-exist"),
    ).resolves.toBeUndefined();
  });

  it("rethrows GithubRateLimitedError instead of swallowing it", async () => {
    mockedSafeGet.mockRejectedValue(
      axiosError(403, { "x-ratelimit-remaining": "0" }),
    );

    await expect(
      resolveGithubDefaultBranch("octocat", "hello-world"),
    ).rejects.toThrow(GithubRateLimitedError);
  });

  it("URL-encodes owner/repo before building the request", async () => {
    mockedSafeGet.mockResolvedValue({
      data: { default_branch: "main" },
      status: 200,
    } as any);

    await resolveGithubDefaultBranch("owner name", "repo#1");

    expect(mockedSafeGet).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner%20name/repo%231",
      expect.anything(),
    );
  });
});

describe("fetchReadmeForBranch", () => {
  it("returns the README body for the given branch", async () => {
    mockedSafeGet.mockResolvedValue({ data: "# Hello", status: 200 } as any);

    const body = await fetchReadmeForBranch(
      "octocat",
      "hello-world",
      "develop",
    );

    expect(body).toBe("# Hello");
    expect(mockedSafeGet).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/octocat/hello-world/develop/README.md",
    );
  });

  it("returns undefined on a 404 without throwing", async () => {
    mockedSafeGet.mockRejectedValue(axiosError(404));

    await expect(
      fetchReadmeForBranch("octocat", "hello-world", "develop"),
    ).resolves.toBeUndefined();
  });

  it("truncates content over 100000 characters", async () => {
    mockedSafeGet.mockResolvedValue({
      data: "x".repeat(150_000),
      status: 200,
    } as any);

    const body = await fetchReadmeForBranch("octocat", "hello-world", "main");

    expect(body).toHaveLength(100_000);
  });

  it("logs a debug entry with owner/repo/branch context on a miss", async () => {
    const debugSpy = jest
      .spyOn(Logger.prototype, "debug")
      .mockImplementation(() => undefined);
    mockedSafeGet.mockRejectedValue(axiosError(404));

    await fetchReadmeForBranch("octocat", "hello-world", "develop");

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("octocat/hello-world@develop"),
    );

    debugSpy.mockRestore();
  });
});

describe("convertGitHubUrlToRaw", () => {
  it("converts a blob URL to its raw-content equivalent", () => {
    expect(
      convertGitHubUrlToRaw(
        "https://github.com/octocat/hello-world/blob/main/src/index.js",
      ),
    ).toBe(
      "https://raw.githubusercontent.com/octocat/hello-world/main/src/index.js",
    );
  });

  it("returns null for a non-blob URL", () => {
    expect(
      convertGitHubUrlToRaw("https://github.com/octocat/hello-world"),
    ).toBeNull();
  });
});
