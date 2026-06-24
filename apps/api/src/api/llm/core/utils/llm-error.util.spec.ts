import {
  classifyLlmError,
  isContextLengthExceededError,
  LlmQuotaExceededError,
} from "./llm-error.util";

describe("isContextLengthExceededError", () => {
  it("detects a top-level code of context_length_exceeded", () => {
    const error = Object.assign(new Error("Request failed"), {
      code: "context_length_exceeded",
    });
    expect(isContextLengthExceededError(error)).toBe(true);
  });

  it("detects a nested error.code of context_length_exceeded", () => {
    const error = Object.assign(new Error("Request failed"), {
      error: { code: "context_length_exceeded" },
    });
    expect(isContextLengthExceededError(error)).toBe(true);
  });

  it("detects the message-only OpenAI context-length wording", () => {
    const error = new Error(
      "This model's maximum context length is 128000 tokens. " +
        "However, your messages resulted in 159000 tokens. " +
        "Please reduce the length of the messages.",
    );
    expect(isContextLengthExceededError(error)).toBe(true);
  });

  it("does not match a rate-limit error", () => {
    expect(
      isContextLengthExceededError(
        new Error("Rate limit reached for gpt-4o-mini"),
      ),
    ).toBe(false);
  });

  it("does not match a transport-level error", () => {
    expect(isContextLengthExceededError(new Error("ECONNRESET"))).toBe(false);
  });

  it("does not match a non-Error value", () => {
    expect(isContextLengthExceededError("some string")).toBe(false);
  });
});

describe("classifyLlmError", () => {
  it("classifies the OpenAI insufficient_quota 429 as quota (non-retryable)", () => {
    const error = Object.assign(
      new Error(
        "429 You exceeded your current quota, please check your plan and billing details.",
      ),
      { status: 429 },
    );
    const result = classifyLlmError(error);
    expect(result.kind).toBe("quota");
    expect(result.retryable).toBe(false);
  });

  it("classifies insufficient_quota by code even without the message text", () => {
    const error = Object.assign(new Error("Request failed"), {
      status: 429,
      code: "insufficient_quota",
    });
    expect(classifyLlmError(error).kind).toBe("quota");
  });

  it("classifies a nested insufficient_quota code as quota", () => {
    const error = Object.assign(new Error("Request failed with status 429"), {
      error: { type: "insufficient_quota" },
    });
    expect(classifyLlmError(error).kind).toBe("quota");
  });

  it("classifies a plain RPM rate-limit 429 as rate_limit (retryable)", () => {
    const error = Object.assign(
      new Error("Rate limit reached for gpt-4o-mini. Please try again in 1s."),
      { status: 429, code: "rate_limit_exceeded" },
    );
    const result = classifyLlmError(error);
    expect(result.kind).toBe("rate_limit");
    expect(result.retryable).toBe(true);
  });

  it("does NOT treat a quota 429 as a retryable rate_limit", () => {
    const error = Object.assign(new Error("You exceeded your current quota"), {
      status: 429,
    });
    expect(classifyLlmError(error).retryable).toBe(false);
  });

  it("classifies 5xx as transient (retryable)", () => {
    const error = Object.assign(new Error("Bad gateway"), { status: 503 });
    const result = classifyLlmError(error);
    expect(result.kind).toBe("transient");
    expect(result.retryable).toBe(true);
  });

  it("classifies a network reset as transient", () => {
    expect(classifyLlmError(new Error("ECONNRESET")).kind).toBe("transient");
  });

  it("classifies a context-length 400 as terminal (non-retryable)", () => {
    const error = Object.assign(
      new Error("This model's maximum context length is 128000 tokens."),
      { status: 400 },
    );
    const result = classifyLlmError(error);
    expect(result.kind).toBe("terminal");
    expect(result.retryable).toBe(false);
  });

  it("classifies an auth 401 as terminal", () => {
    const error = Object.assign(new Error("Invalid API key"), { status: 401 });
    expect(classifyLlmError(error).kind).toBe("terminal");
  });

  it("never throws on a non-object value", () => {
    expect(classifyLlmError("boom").kind).toBe("terminal");
    expect(classifyLlmError(undefined).kind).toBe("terminal");
  });
});

describe("LlmQuotaExceededError", () => {
  it("carries a retryAfterSeconds hint and preserves the cause", () => {
    const cause = new Error("original 429");
    const error = new LlmQuotaExceededError("LLM temporarily unavailable", {
      retryAfterSeconds: 60,
      cause,
    });
    expect(error.retryAfterSeconds).toBe(60);
    expect(error.name).toBe("LlmQuotaExceededError");
    expect((error as { cause?: unknown }).cause).toBe(cause);
  });
});
