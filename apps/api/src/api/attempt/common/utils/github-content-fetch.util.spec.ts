import { Logger } from "@nestjs/common";
import { GithubRateLimitedError } from "src/api/llm/features/grading/errors/github-rate-limited.error";
import { safeGet } from "./ssrf-safe-http";
import {
  clearGithubDefaultBranchCache,
  convertGitHubUrlToRaw,
  fetchReadmeForBranch,
  fetchUrlContentForGrading,
  githubApiGet,
  resolveGithubDefaultBranch,
} from "./github-content-fetch.util";

jest.mock("./ssrf-safe-http", () => ({
  safeGet: jest.fn(),
}));

const mockedSafeGet = safeGet as jest.MockedFunction<typeof safeGet>;

// The default-branch cache is module-level state shared across every test in
// this file (many reuse "octocat/hello-world"); clear it after each case so
// a resolution cached by one test can't change another's expected call count.
afterEach(() => {
  clearGithubDefaultBranchCache();
});

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

describe("resolveGithubDefaultBranch caching", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("makes one API call for two fetches of the same owner/repo", async () => {
    mockedSafeGet.mockResolvedValue({
      data: { default_branch: "develop" },
      status: 200,
    } as any);

    const first = await resolveGithubDefaultBranch("octocat", "hello-world");
    const second = await resolveGithubDefaultBranch("octocat", "hello-world");

    expect(first).toBe("develop");
    expect(second).toBe("develop");
    expect(mockedSafeGet).toHaveBeenCalledTimes(1);
  });

  it("does not serve a cached entry past its TTL", async () => {
    let now = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    mockedSafeGet.mockResolvedValue({
      data: { default_branch: "develop" },
      status: 200,
    } as any);

    await resolveGithubDefaultBranch("octocat", "hello-world");
    expect(mockedSafeGet).toHaveBeenCalledTimes(1);

    // Still within the 5-minute TTL: served from cache, no second call.
    now += 4 * 60 * 1000;
    await resolveGithubDefaultBranch("octocat", "hello-world");
    expect(mockedSafeGet).toHaveBeenCalledTimes(1);

    // Past the TTL: must re-fetch.
    now += 2 * 60 * 1000;
    await resolveGithubDefaultBranch("octocat", "hello-world");
    expect(mockedSafeGet).toHaveBeenCalledTimes(2);
  });

  it("does not cache a rate-limited lookup — the next call retries", async () => {
    mockedSafeGet.mockRejectedValue(
      axiosError(403, { "x-ratelimit-remaining": "0" }),
    );

    await expect(
      resolveGithubDefaultBranch("octocat", "hello-world"),
    ).rejects.toThrow(GithubRateLimitedError);
    await expect(
      resolveGithubDefaultBranch("octocat", "hello-world"),
    ).rejects.toThrow(GithubRateLimitedError);

    expect(mockedSafeGet).toHaveBeenCalledTimes(2);
  });

  it("does not cache a non-rate-limit failure — the next call retries", async () => {
    mockedSafeGet.mockRejectedValue(axiosError(500));

    await resolveGithubDefaultBranch("octocat", "hello-world");
    await resolveGithubDefaultBranch("octocat", "hello-world");

    expect(mockedSafeGet).toHaveBeenCalledTimes(2);
  });

  it("keeps separate cache entries per owner/repo", async () => {
    mockedSafeGet.mockImplementation(async (url: string) => {
      if (url === "https://api.github.com/repos/octocat/hello-world") {
        return { data: { default_branch: "develop" }, status: 200 } as any;
      }
      if (url === "https://api.github.com/repos/other/repo") {
        return { data: { default_branch: "trunk" }, status: 200 } as any;
      }
      throw axiosError(404);
    });

    expect(await resolveGithubDefaultBranch("octocat", "hello-world")).toBe(
      "develop",
    );
    expect(await resolveGithubDefaultBranch("other", "repo")).toBe("trunk");
    expect(await resolveGithubDefaultBranch("octocat", "hello-world")).toBe(
      "develop",
    );

    expect(mockedSafeGet).toHaveBeenCalledTimes(2);
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

  it("encodes each segment of a slash-containing branch name without escaping the slash itself", async () => {
    mockedSafeGet.mockResolvedValue({
      data: "# Release readme",
      status: 200,
    } as any);

    const body = await fetchReadmeForBranch(
      "octocat",
      "hello-world",
      "release/2.0",
    );

    expect(body).toBe("# Release readme");
    expect(mockedSafeGet).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/octocat/hello-world/release/2.0/README.md",
    );
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

describe("fetchUrlContentForGrading", () => {
  describe("blob URLs", () => {
    it("fetches raw content for a blob URL", async () => {
      mockedSafeGet.mockResolvedValue({
        data: "console.log(1)",
        status: 200,
      } as any);

      const result = await fetchUrlContentForGrading(
        "https://github.com/octocat/hello-world/blob/main/index.js",
      );

      expect(result).toEqual({ body: "console.log(1)", isFunctional: true });
    });

    it("returns isFunctional:false when the blob fetch fails, without throwing", async () => {
      mockedSafeGet.mockRejectedValue(axiosError(404));

      const result = await fetchUrlContentForGrading(
        "https://github.com/octocat/hello-world/blob/main/missing.js",
      );

      expect(result).toEqual({ body: "", isFunctional: false });
    });
  });

  describe("repo-root URLs — the reported bug", () => {
    it("resolves a non-main/master default branch and fetches its README", async () => {
      mockedSafeGet.mockImplementation(async (url: string) => {
        if (url === "https://api.github.com/repos/octocat/hello-world") {
          return { data: { default_branch: "develop" }, status: 200 } as any;
        }
        if (
          url ===
          "https://raw.githubusercontent.com/octocat/hello-world/develop/README.md"
        ) {
          return { data: "# Develop branch readme", status: 200 } as any;
        }
        throw axiosError(404);
      });

      const result = await fetchUrlContentForGrading(
        "https://github.com/octocat/hello-world",
      );

      expect(result).toEqual({
        body: "# Develop branch readme",
        isFunctional: true,
      });
      // Must not have guessed main/master when the real branch resolved.
      expect(mockedSafeGet).not.toHaveBeenCalledWith(
        expect.stringContaining("/main/README.md"),
      );
    });

    it("falls back to main/master guesses when branch resolution fails for a non-rate-limit reason", async () => {
      mockedSafeGet.mockImplementation(async (url: string) => {
        if (url === "https://api.github.com/repos/octocat/hello-world") {
          throw axiosError(500);
        }
        if (
          url ===
          "https://raw.githubusercontent.com/octocat/hello-world/main/README.md"
        ) {
          throw axiosError(404);
        }
        if (
          url ===
          "https://raw.githubusercontent.com/octocat/hello-world/master/README.md"
        ) {
          return { data: "# Master readme", status: 200 } as any;
        }
        throw axiosError(404);
      });

      const result = await fetchUrlContentForGrading(
        "https://github.com/octocat/hello-world",
      );

      expect(result).toEqual({ body: "# Master readme", isFunctional: true });
    });

    it("throws GithubRateLimitedError instead of silently grading 0 when rate-limited and no README guess lands", async () => {
      mockedSafeGet.mockImplementation(async (url: string) => {
        if (url === "https://api.github.com/repos/octocat/hello-world") {
          throw axiosError(403, {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": "1800000000",
            "retry-after": "45",
          });
        }
        // main/master guesses also miss (private repo, or genuinely no readme)
        throw axiosError(404);
      });

      const rejection = await fetchUrlContentForGrading(
        "https://github.com/octocat/hello-world",
      ).then(
        () => {
          throw new Error("expected fetchUrlContentForGrading to reject");
        },
        (error: unknown) => error,
      );

      expect(rejection).toBeInstanceOf(GithubRateLimitedError);
      // The primary rate-limit path must carry the real timing fields from
      // the response headers, not a fresh error constructed with none.
      expect((rejection as GithubRateLimitedError).resetAt).toBe(1_800_000_000);
      expect((rejection as GithubRateLimitedError).retryAfterSeconds).toBe(45);
    });

    it("skips the metadata fallback call once rate-limiting is already known", async () => {
      let metadataCallCount = 0;
      mockedSafeGet.mockImplementation(async (url: string) => {
        if (url === "https://api.github.com/repos/octocat/hello-world") {
          metadataCallCount++;
          throw axiosError(403, { "x-ratelimit-remaining": "0" });
        }
        throw axiosError(404);
      });

      await expect(
        fetchUrlContentForGrading("https://github.com/octocat/hello-world"),
      ).rejects.toThrow(GithubRateLimitedError);
      // One call for default-branch resolution; the metadata-fallback call
      // (the same endpoint) must NOT fire a second time once we already
      // know the surface is exhausted.
      expect(metadataCallCount).toBe(1);
    });

    it("falls through to the metadata summary, then the DOM scrape, when README lookups miss for a non-rate-limit reason", async () => {
      mockedSafeGet.mockImplementation(async (url: string) => {
        if (url === "https://api.github.com/repos/octocat/hello-world") {
          return {
            data: {
              full_name: "octocat/hello-world",
              description: "A test repo",
              stargazers_count: 5,
              forks_count: 1,
              language: "JavaScript",
              updated_at: "2026-01-01T00:00:00Z",
            },
            status: 200,
          } as any;
        }
        throw axiosError(404); // README misses on the resolved branch
      });

      const result = await fetchUrlContentForGrading(
        "https://github.com/octocat/hello-world",
      );

      expect(result.isFunctional).toBe(true);
      expect(result.body).toContain("octocat/hello-world");
      expect(result.body).toContain("JavaScript");
    });

    it("scrapes the repo page as a true last resort when every API path fails without rate-limiting", async () => {
      mockedSafeGet.mockImplementation(async (url: string) => {
        if (url === "https://github.com/octocat/hello-world") {
          return {
            data: '<html><body><article class="markdown-body">Scraped readme text</article></body></html>',
            status: 200,
          } as any;
        }
        throw axiosError(404);
      });

      const result = await fetchUrlContentForGrading(
        "https://github.com/octocat/hello-world",
      );

      expect(result).toEqual({
        body: "Scraped readme text",
        isFunctional: true,
      });
    });

    it("returns isFunctional:false when every path — including the scrape — fails, and it is not a rate limit", async () => {
      mockedSafeGet.mockRejectedValue(axiosError(404));

      const result = await fetchUrlContentForGrading(
        "https://github.com/octocat/hello-world",
      );

      expect(result).toEqual({ body: "", isFunctional: false });
    });

    it("propagates GithubRateLimitedError when the metadata-fallback call itself is rate-limited after README misses", async () => {
      // Default-branch resolution succeeds (not rate-limited) on the first
      // call; the README for that branch misses; the metadata-fallback call
      // reuses the exact same api.github.com endpoint and is rate-limited on
      // its own second, independent attempt. This exercises the
      // `fetchRepoMetadataSummary` catch's GithubRateLimitedError rethrow,
      // which is a different path than the default-branch-resolution
      // rate-limit case covered above.
      let metadataEndpointCallCount = 0;
      mockedSafeGet.mockImplementation(async (url: string) => {
        if (url === "https://api.github.com/repos/octocat/hello-world") {
          metadataEndpointCallCount++;
          if (metadataEndpointCallCount === 1) {
            return { data: { default_branch: "develop" }, status: 200 } as any;
          }
          throw axiosError(403, { "x-ratelimit-remaining": "0" });
        }
        // README lookup on the resolved "develop" branch misses.
        throw axiosError(404);
      });

      await expect(
        fetchUrlContentForGrading("https://github.com/octocat/hello-world"),
      ).rejects.toThrow(GithubRateLimitedError);

      // First call resolves the default branch; second is the metadata
      // fallback attempt that hits the rate limit.
      expect(metadataEndpointCallCount).toBe(2);
    });
  });

  describe("non-repo-root github.com URLs (e.g. an issue page)", () => {
    it("scrapes directly without attempting branch/README resolution", async () => {
      mockedSafeGet.mockResolvedValue({
        data: '<html><body><div class="Box-body">Issue content</div></body></html>',
        status: 200,
      } as any);

      const result = await fetchUrlContentForGrading(
        "https://github.com/octocat/hello-world/issues/5",
      );

      expect(result.isFunctional).toBe(true);
      expect(result.body).toContain("Issue content");
    });
  });

  describe("non-GitHub URLs", () => {
    it("scrapes the page body as plain text", async () => {
      mockedSafeGet.mockResolvedValue({
        data: "<html><body>Hello <b>world</b></body></html>",
        status: 200,
      } as any);

      const result = await fetchUrlContentForGrading(
        "https://example.com/portfolio",
      );

      expect(result).toEqual({ body: "Hello world", isFunctional: true });
    });

    it("returns isFunctional:false (does not throw) when the fetch fails", async () => {
      mockedSafeGet.mockRejectedValue(axiosError(500));

      const result = await fetchUrlContentForGrading(
        "https://example.com/unreachable",
      );

      expect(result).toEqual({ body: "", isFunctional: false });
    });
  });

  describe("entry/outcome logging", () => {
    function messagesContaining(
      spy: jest.SpyInstance,
      substrings: string[],
    ): boolean {
      return spy.mock.calls.some((call) =>
        substrings.every((substring) => String(call[0]).includes(substring)),
      );
    }

    it("logs entry and outcome lines carrying the url, assignmentId, and questionId from logContext", async () => {
      const debugSpy = jest
        .spyOn(Logger.prototype, "debug")
        .mockImplementation(() => undefined);
      mockedSafeGet.mockResolvedValue({
        data: "console.log(1)",
        status: 200,
      } as any);

      const url = "https://github.com/octocat/hello-world/blob/main/index.js";

      await fetchUrlContentForGrading(url, {
        assignmentId: 4242,
        questionId: 77,
      });

      // Entry log, before dispatch even runs.
      expect(
        messagesContaining(debugSpy, [
          "Fetching URL content for grading",
          url,
          "assignmentId=4242",
          "questionId=77",
        ]),
      ).toBe(true);

      // Outcome log, after a successful fetch.
      expect(
        messagesContaining(debugSpy, [
          "succeeded",
          url,
          "assignmentId=4242",
          "questionId=77",
        ]),
      ).toBe(true);

      debugSpy.mockRestore();
    });

    it("never logs the fetched content body, even though it appears in the result", async () => {
      const debugSpy = jest
        .spyOn(Logger.prototype, "debug")
        .mockImplementation(() => undefined);
      const warnSpy = jest
        .spyOn(Logger.prototype, "warn")
        .mockImplementation(() => undefined);

      const sentinelBody = "SENTINEL_CONTENT_9f27ac_never_log_me";
      mockedSafeGet.mockResolvedValue({
        data: sentinelBody,
        status: 200,
      } as any);

      const result = await fetchUrlContentForGrading(
        "https://github.com/octocat/hello-world/blob/main/index.js",
        { assignmentId: 1, questionId: 2 },
      );

      // Sanity check: the sentinel really did flow through into the result.
      expect(result.body).toBe(sentinelBody);

      const allLoggedMessages = [
        ...debugSpy.mock.calls,
        ...warnSpy.mock.calls,
      ].map((call) => String(call[0]));
      expect(
        allLoggedMessages.some((message) => message.includes(sentinelBody)),
      ).toBe(false);

      debugSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });
});
