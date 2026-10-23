jest.mock("./github-app-token", () => ({
  getGithubAppInstallationToken: jest.fn(),
}));

import { getGithubAppInstallationToken } from "./github-app-token";
import { getGithubGradingApiToken } from "./github-grading-token";

const mockAppToken = jest.mocked(getGithubAppInstallationToken);

describe("getGithubGradingApiToken", () => {
  const ORIGINAL_ENV = process.env.GITHUB_GRADING_API_TOKEN;

  beforeEach(() => {
    mockAppToken.mockReset();
    mockAppToken.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.GITHUB_GRADING_API_TOKEN;
    } else {
      process.env.GITHUB_GRADING_API_TOKEN = ORIGINAL_ENV;
    }
  });

  it("returns undefined when neither the env var nor the app is configured", async () => {
    delete process.env.GITHUB_GRADING_API_TOKEN;
    await expect(getGithubGradingApiToken()).resolves.toBeUndefined();
  });

  it("treats an empty or whitespace-only value as unset", async () => {
    process.env.GITHUB_GRADING_API_TOKEN = "   ";
    await expect(getGithubGradingApiToken()).resolves.toBeUndefined();
  });

  it("returns the trimmed env token and does not mint an app token", async () => {
    process.env.GITHUB_GRADING_API_TOKEN = "  ghp_example_token_value  "; // pragma: allowlist secret
    await expect(getGithubGradingApiToken()).resolves.toBe(
      "ghp_example_token_value", // pragma: allowlist secret
    );
    expect(mockAppToken).not.toHaveBeenCalled();
  });

  it("falls back to the GitHub App installation token", async () => {
    delete process.env.GITHUB_GRADING_API_TOKEN;
    mockAppToken.mockResolvedValue("ghs_installation_token"); // pragma: allowlist secret
    await expect(getGithubGradingApiToken()).resolves.toBe(
      "ghs_installation_token", // pragma: allowlist secret
    );
  });
});
