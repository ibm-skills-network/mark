import {
  redactSensitiveQueryForLog,
  redactUrlForLog,
  sanitizeForLog,
} from "./sanitize";

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
    expect(sanitizeForLog(undefined)).toBeUndefined();
  });
});

describe("redactUrlForLog", () => {
  it("keeps origin and path but drops the query string of an absolute URL", () => {
    expect(
      redactUrlForLog(
        "https://mark.example/learner/3601/questions?code=abc123&state=xyz",
      ),
    ).toBe("https://mark.example/learner/3601/questions");
  });

  it("drops the query string of a relative URL", () => {
    expect(redactUrlForLog("/learner/3601/questions?code=abc123")).toBe(
      "/learner/3601/questions",
    );
  });

  it("drops the fragment", () => {
    expect(
      redactUrlForLog("https://mark.example/learner#access_token=abc123"),
    ).toBe("https://mark.example/learner");
  });

  it("drops everything after a fragment that precedes a query marker", () => {
    expect(redactUrlForLog("https://mark.example/p#frag?code=abc123")).toBe(
      "https://mark.example/p",
    );
  });

  it("returns a URL without a query string unchanged", () => {
    expect(redactUrlForLog("https://mark.example/learner/3601")).toBe(
      "https://mark.example/learner/3601",
    );
  });

  it("does not throw on a malformed value and still drops the query part", () => {
    expect(redactUrlForLog("not a url at all?code=abc123")).toBe(
      "not a url at all",
    );
    expect(redactUrlForLog("://%%%?code=abc123")).toBe("://%%%");
  });

  it("returns an empty string for empty, missing or non-string input", () => {
    expect(redactUrlForLog("")).toBe("");
    expect(redactUrlForLog(undefined)).toBe("");
    expect(redactUrlForLog(null)).toBe("");
    expect(redactUrlForLog(123)).toBe("");
  });

  it("strips control characters from what it keeps", () => {
    expect(redactUrlForLog("/learner/3601\n/questions?code=abc123")).toBe(
      "/learner/3601 /questions",
    );
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
    expect(redactSensitiveQueryForLog(undefined)).toBe("");
    expect(redactSensitiveQueryForLog(null)).toBe("");
    expect(redactSensitiveQueryForLog(123)).toBe("");
  });

  it("strips control characters", () => {
    expect(redactSensitiveQueryForLog("/x\n/y?lang=en")).toBe("/x /y?lang=en");
  });
});
