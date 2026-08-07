import {
  isGithubRateLimitResponse,
  parseGithubRateLimitInfo,
} from "./github-rate-limit-detection.util";

describe("isGithubRateLimitResponse", () => {
  it("is true for a 403 with x-ratelimit-remaining: 0", () => {
    expect(
      isGithubRateLimitResponse(403, { "x-ratelimit-remaining": "0" }),
    ).toBe(true);
  });

  it("is true for a 429 with x-ratelimit-remaining: 0", () => {
    expect(
      isGithubRateLimitResponse(429, { "x-ratelimit-remaining": "0" }),
    ).toBe(true);
  });

  it("is true for a secondary/abuse-detection 403 carrying retry-after with no ratelimit-remaining", () => {
    expect(isGithubRateLimitResponse(403, { "retry-after": "30" })).toBe(true);
  });

  it("is true for a secondary/abuse-detection 429 carrying retry-after with no ratelimit-remaining", () => {
    expect(isGithubRateLimitResponse(429, { "retry-after": "30" })).toBe(true);
  });

  it("is false for a plain 429 with no rate-limit headers at all", () => {
    expect(isGithubRateLimitResponse(429, {})).toBe(false);
    expect(isGithubRateLimitResponse(429, undefined)).toBe(false);
  });

  it("is case-insensitive on header keys", () => {
    expect(
      isGithubRateLimitResponse(403, { "X-RateLimit-Remaining": "0" }),
    ).toBe(true);
  });

  it("is false for an ordinary 403 with no rate-limit headers (e.g. private repo)", () => {
    expect(isGithubRateLimitResponse(403, {})).toBe(false);
    expect(isGithubRateLimitResponse(403, undefined)).toBe(false);
  });

  it("is false for a 404", () => {
    expect(
      isGithubRateLimitResponse(404, { "x-ratelimit-remaining": "0" }),
    ).toBe(false);
  });

  it("is false for a 200", () => {
    expect(isGithubRateLimitResponse(200, {})).toBe(false);
  });
});

describe("parseGithubRateLimitInfo", () => {
  it("extracts resetAt and retryAfterSeconds", () => {
    const info = parseGithubRateLimitInfo({
      "x-ratelimit-reset": "1800000000",
      "retry-after": "30",
    });
    expect(info.resetAt).toBe(1_800_000_000);
    expect(info.retryAfterSeconds).toBe(30);
  });

  it("returns undefined fields when headers are missing or malformed", () => {
    expect(parseGithubRateLimitInfo(undefined)).toEqual({
      resetAt: undefined,
      retryAfterSeconds: undefined,
    });
    expect(
      parseGithubRateLimitInfo({ "x-ratelimit-reset": "not-a-number" }),
    ).toEqual({ resetAt: undefined, retryAfterSeconds: undefined });
  });
});
