import { GithubRateLimitedError } from "../../../llm/features/grading/errors/github-rate-limited.error";
import * as githubContentFetch from "../../../attempt/common/utils/github-content-fetch.util";
import { AttemptHelper } from "./attempts.helper";

jest.mock("../../../attempt/common/utils/github-content-fetch.util");

const mockedFetch =
  githubContentFetch.fetchUrlContentForGrading as jest.MockedFunction<
    typeof githubContentFetch.fetchUrlContentForGrading
  >;

describe("AttemptHelper.fetchPlainTextFromUrl", () => {
  beforeEach(() => {
    mockedFetch.mockReset();
  });

  it("delegates to the shared fetchUrlContentForGrading helper", async () => {
    mockedFetch.mockResolvedValue({ body: "content", isFunctional: true });

    const result = await AttemptHelper.fetchPlainTextFromUrl(
      "https://github.com/octocat/hello-world",
    );

    expect(mockedFetch).toHaveBeenCalledWith(
      "https://github.com/octocat/hello-world",
    );
    expect(result).toEqual({ body: "content", isFunctional: true });
  });

  it("propagates GithubRateLimitedError rather than swallowing it", async () => {
    mockedFetch.mockRejectedValue(
      new GithubRateLimitedError({
        owner: "octocat",
        repo: "hello-world",
        requestUrl: "https://api.github.com/repos/octocat/hello-world",
      }),
    );

    await expect(
      AttemptHelper.fetchPlainTextFromUrl(
        "https://github.com/octocat/hello-world",
      ),
    ).rejects.toThrow(GithubRateLimitedError);
  });
});
