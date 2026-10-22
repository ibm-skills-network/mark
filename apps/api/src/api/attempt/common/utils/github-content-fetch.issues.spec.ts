import { Logger } from "@nestjs/common";
import { safeGet } from "./ssrf-safe-http";
import {
  clearGithubDefaultBranchCache,
  fetchUrlContentForGrading,
} from "./github-content-fetch.util";

jest.mock("./ssrf-safe-http", () => ({
  ...jest.requireActual<typeof import("./ssrf-safe-http")>("./ssrf-safe-http"),
  safeGet: jest.fn(),
}));

const mockedSafeGet = safeGet as jest.MockedFunction<typeof safeGet>;

function axiosError(status: number) {
  return {
    isAxiosError: true,
    message: `Request failed with status code ${status}`,
    response: { status, headers: {}, data: {} },
  };
}

type Route = (url: string) => unknown;

/** Answers each requested URL from a table; anything unlisted is a 404. */
function routeRequests(routes: Record<string, unknown>, fallback?: Route) {
  mockedSafeGet.mockImplementation((async (url: string) => {
    if (url in routes) {
      const value = routes[url];
      if (
        value instanceof Error ||
        (value as { isAxiosError?: boolean })?.isAxiosError
      ) {
        throw value;
      }
      return { status: 200, data: value, headers: {} };
    }
    if (fallback) return fallback(url);
    throw axiosError(404);
  }) as unknown as typeof safeGet);
}

afterEach(() => {
  mockedSafeGet.mockReset();
  clearGithubDefaultBranchCache();
  jest.restoreAllMocks();
});

describe("GitHub folder (/tree/) links", () => {
  it("reads the folder through the contents API instead of scraping the page", async () => {
    routeRequests({
      "https://api.github.com/repos/dishan-git-jain/oaqjp-final-project-emb-ai/contents/EmotionDetection?ref=main":
        [
          {
            type: "file",
            name: "emotion_detection.py",
            path: "EmotionDetection/emotion_detection.py",
            size: 40,
            download_url:
              "https://raw.githubusercontent.com/dishan-git-jain/oaqjp-final-project-emb-ai/main/EmotionDetection/emotion_detection.py",
          },
          {
            type: "file",
            name: "__init__.py",
            path: "EmotionDetection/__init__.py",
            size: 30,
            download_url:
              "https://raw.githubusercontent.com/dishan-git-jain/oaqjp-final-project-emb-ai/main/EmotionDetection/__init__.py",
          },
          { type: "dir", name: "tests", path: "EmotionDetection/tests" },
          {
            type: "file",
            name: "diagram.png",
            path: "EmotionDetection/diagram.png",
            size: 10,
            download_url:
              "https://raw.githubusercontent.com/dishan-git-jain/oaqjp-final-project-emb-ai/main/EmotionDetection/diagram.png",
          },
        ],
      "https://raw.githubusercontent.com/dishan-git-jain/oaqjp-final-project-emb-ai/main/EmotionDetection/emotion_detection.py":
        "def emotion_detector(text):\n    return {}\n",
      "https://raw.githubusercontent.com/dishan-git-jain/oaqjp-final-project-emb-ai/main/EmotionDetection/__init__.py":
        "from . import emotion_detection\n",
    });

    const result = await fetchUrlContentForGrading(
      "https://github.com/dishan-git-jain/oaqjp-final-project-emb-ai/tree/main/EmotionDetection",
    );

    expect(result.isFunctional).toBe(true);
    expect(result.failure).toBeUndefined();
    expect(result.evidenceKind).toBeUndefined();
    expect(result.body).toContain("def emotion_detector(text):");
    expect(result.body).toContain("from . import emotion_detection");
    expect(result.body).toContain("- tests/");
    // Binary files are listed but never downloaded.
    expect(result.body).toContain("- diagram.png");
    expect(mockedSafeGet).not.toHaveBeenCalledWith(
      expect.stringContaining("diagram.png"),
      expect.anything(),
    );
    expect(mockedSafeGet).not.toHaveBeenCalledWith(
      "https://github.com/dishan-git-jain/oaqjp-final-project-emb-ai/tree/main/EmotionDetection",
      expect.anything(),
    );
  });

  it("encodes folder names with spaces once, as GitHub expects", async () => {
    routeRequests({
      "https://api.github.com/repos/dennislamcv1/IBMFULLSTACK/contents/Full%20Stack%20Cloud%20Development%20Capstone%20Project/server/djangoapp/templates/djangoapp?ref=main":
        [
          {
            type: "file",
            name: "about.html",
            path: "x/about.html",
            size: 20,
            download_url:
              "https://raw.githubusercontent.com/d/I/main/x/about.html",
          },
        ],
      "https://raw.githubusercontent.com/d/I/main/x/about.html":
        "<h1>About</h1>",
    });

    const result = await fetchUrlContentForGrading(
      "https://github.com/dennislamcv1/IBMFULLSTACK/tree/main/Full%20Stack%20Cloud%20Development%20Capstone%20Project/server/djangoapp/templates/djangoapp",
    );

    expect(result.isFunctional).toBe(true);
    expect(result.body).toContain("<h1>About</h1>");
  });

  it("tries a branch name containing a slash when the one-segment split 404s", async () => {
    routeRequests({
      "https://api.github.com/repos/o/r/contents/src?ref=feature%2Fx": [
        {
          type: "file",
          name: "a.js",
          path: "src/a.js",
          size: 5,
          download_url:
            "https://raw.githubusercontent.com/o/r/feature/x/src/a.js",
        },
      ],
      "https://raw.githubusercontent.com/o/r/feature/x/src/a.js": "let a = 1;",
    });

    const result = await fetchUrlContentForGrading(
      "https://github.com/o/r/tree/feature/x/src",
    );

    expect(result.body).toContain("let a = 1;");
  });

  it("caps how many files of a large folder are downloaded", async () => {
    const entries = Array.from({ length: 40 }, (_, index) => ({
      type: "file",
      name: `f${String(index).padStart(2, "0")}.py`,
      path: `pkg/f${String(index).padStart(2, "0")}.py`,
      size: 10,
      download_url: `https://raw.githubusercontent.com/o/r/main/pkg/f${index}.py`,
    }));
    routeRequests(
      { "https://api.github.com/repos/o/r/contents/pkg?ref=main": entries },
      (url) => ({ status: 200, data: `# ${url}`, headers: {} }),
    );

    const result = await fetchUrlContentForGrading(
      "https://github.com/o/r/tree/main/pkg",
    );

    const downloads = mockedSafeGet.mock.calls.filter(([url]) =>
      String(url).startsWith("https://raw.githubusercontent.com/"),
    );
    expect(downloads).toHaveLength(25);
    expect(result.body).toContain("- f39.py");
  });

  it("reports a folder GitHub can't find (missing or private) as unreachable", async () => {
    routeRequests({});

    await expect(
      fetchUrlContentForGrading(
        "https://github.com/o/private-repo/tree/main/src",
      ),
    ).resolves.toEqual({
      body: "",
      isFunctional: false,
      failure: { code: "url_unreachable", httpStatus: 404 },
    });
  });

  it("reports an empty folder as empty", async () => {
    routeRequests({
      "https://api.github.com/repos/o/r/contents/empty?ref=main": [],
    });

    await expect(
      fetchUrlContentForGrading("https://github.com/o/r/tree/main/empty"),
    ).resolves.toMatchObject({
      isFunctional: false,
      failure: { code: "url_empty" },
    });
  });
});

describe("repository clone addresses", () => {
  it("strips a trailing .git before asking GitHub about the repository", async () => {
    routeRequests({
      "https://api.github.com/repos/AinurSarsenbai/fullstack-capstone-project":
        { default_branch: "main" },
      "https://raw.githubusercontent.com/AinurSarsenbai/fullstack-capstone-project/main/README.md":
        "# Capstone",
    });

    const result = await fetchUrlContentForGrading(
      "https://github.com/AinurSarsenbai/fullstack-capstone-project.git",
    );

    expect(result).toMatchObject({
      isFunctional: true,
      body: "# Capstone",
      evidenceKind: "readme",
    });
    expect(mockedSafeGet).not.toHaveBeenCalledWith(
      expect.stringMatching(/project\.git/),
      expect.anything(),
    );
  });
});

describe("non-GitHub pages", () => {
  it("asks for HTML the way a browser does", async () => {
    routeRequests({
      "https://hh.kz/vacancies/koordinator_proektov":
        "<html><body><h1>Project coordinator</h1></body></html>",
    });

    const result = await fetchUrlContentForGrading(
      "https://hh.kz/vacancies/koordinator_proektov",
    );

    expect(result).toMatchObject({ isFunctional: true });
    const [, config] = mockedSafeGet.mock.calls[0];
    const headers = (config?.headers ?? {}) as Record<string, string>;
    expect(headers.Accept).toMatch(/^text\/html/);
    expect(headers.Accept).not.toMatch(/^application\/json/);
    expect(headers["User-Agent"]).toMatch(/Mozilla\/5\.0/);
  });

  it.each([401, 403, 406])(
    "reports a %d refusal as a site that blocks automated access",
    async (status) => {
      routeRequests({
        "https://www.indeed.com/q-jobs.html": axiosError(status),
      });

      await expect(
        fetchUrlContentForGrading("https://www.indeed.com/q-jobs.html"),
      ).resolves.toEqual({
        body: "",
        isFunctional: false,
        failure: { code: "url_blocked", httpStatus: status },
      });
    },
  );

  it("reports a page with no readable text as empty and logs where it was", async () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    routeRequests({
      "https://tourstravel30.wordpress.com/?page_id=12":
        "<html><body><script>render()</script></body></html>",
    });

    const result = await fetchUrlContentForGrading(
      "https://tourstravel30.wordpress.com/?page_id=12",
      { assignmentId: 1179, questionId: 2434 },
    );

    expect(result).toMatchObject({
      isFunctional: false,
      failure: { code: "url_empty", httpStatus: 200 },
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /no gradeable content \(host=tourstravel30\.wordpress\.com, failure=url_empty.*questionId=2434/,
      ),
    );
  });
});
