import { isContextLengthExceededError } from "./llm-error.util";

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
