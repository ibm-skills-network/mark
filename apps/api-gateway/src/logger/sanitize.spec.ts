import { redactSensitiveQueryForLog, sanitizeForLog } from "./sanitize";

describe("sanitizeForLog", () => {
  it("replaces control characters so a value cannot forge extra log lines", () => {
    expect(sanitizeForLog("a\nb\r\nc")).toBe("a b  c");
  });

  it("truncates very long values", () => {
    const result = sanitizeForLog("x".repeat(600));
    expect(result).toHaveLength(501);
    expect(result).toMatch(/…$/);
  });

  it("passes non-string values through untouched", () => {
    expect(sanitizeForLog(42)).toBe(42);
    // eslint-disable-next-line unicorn/no-useless-undefined -- a missing value is the case under test
    expect(sanitizeForLog(undefined)).toBeUndefined();
  });
});

describe("redactSensitiveQueryForLog", () => {
  it("keeps query strings that carry no secrets", () => {
    expect(
      redactSensitiveQueryForLog("/api/v2/assignments/3601?lang=en&page=2"),
    ).toBe("/api/v2/assignments/3601?lang=en&page=2");
  });

  it("redacts only the deny-listed keys and keeps the rest", () => {
    expect(
      redactSensitiveQueryForLog(
        "/learner/3601/questions?lang=en&code=abc123&state=xyz&iss=github",
      ),
    ).toBe(
      "/learner/3601/questions?lang=en&code=[redacted]&state=[redacted]&iss=github",
    );
  });

  it("redacts every deny-listed key", () => {
    const denied = [
      "code",
      "state",
      "token",
      "access_token",
      "authentication",
      "key",
      "secret",
      "signature",
    ];
    for (const denyKey of denied) {
      expect(redactSensitiveQueryForLog(`/x?${denyKey}=leaked`)).toBe(
        `/x?${denyKey}=[redacted]`,
      );
    }
  });

  it("matches deny-listed keys case-insensitively", () => {
    expect(redactSensitiveQueryForLog("/x?Access_Token=leaked")).toBe(
      "/x?Access_Token=[redacted]",
    );
  });

  it("does not redact keys that merely contain a deny-listed word", () => {
    expect(redactSensitiveQueryForLog("/x?keyword=abc&statement=def")).toBe(
      "/x?keyword=abc&statement=def",
    );
  });

  it("redacts a deny-listed key carried in a fragment", () => {
    expect(
      redactSensitiveQueryForLog("/x?lang=en#access_token=leaked&a=b"),
    ).toBe("/x?lang=en#access_token=[redacted]&a=b");
  });

  it("handles an absolute URL", () => {
    expect(
      redactSensitiveQueryForLog("https://mark.example/learner?code=abc123"),
    ).toBe("https://mark.example/learner?code=[redacted]");
  });

  it("leaves a URL without a query string unchanged", () => {
    expect(redactSensitiveQueryForLog("/api/v2/user-session")).toBe(
      "/api/v2/user-session",
    );
  });

  it("does not throw on a malformed value", () => {
    expect(redactSensitiveQueryForLog("/x?&&=&code")).toBe("/x?&&=&code");
    expect(redactSensitiveQueryForLog("://%%%?code=abc")).toBe(
      "://%%%?code=[redacted]",
    );
  });

  it("returns an empty string for empty, missing or non-string input", () => {
    expect(redactSensitiveQueryForLog("")).toBe("");
    // eslint-disable-next-line unicorn/no-useless-undefined -- a missing value is the case under test
    expect(redactSensitiveQueryForLog(undefined)).toBe("");
    // eslint-disable-next-line unicorn/no-null -- Express hands back null for an absent value
    expect(redactSensitiveQueryForLog(null)).toBe("");
    expect(redactSensitiveQueryForLog(123)).toBe("");
  });

  it("strips control characters", () => {
    expect(redactSensitiveQueryForLog("/x\n/y?lang=en")).toBe("/x /y?lang=en");
  });
});
