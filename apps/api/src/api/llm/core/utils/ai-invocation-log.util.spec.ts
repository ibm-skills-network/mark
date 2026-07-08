import { Logger } from "winston";
import { logAiInvocation } from "./ai-invocation-log.util";

describe("logAiInvocation", () => {
  let logger: Logger;
  let infoMock: jest.Mock;

  beforeEach(() => {
    infoMock = jest.fn();
    logger = { info: infoMock } as unknown as Logger;
  });

  it("logs the model, purpose, prompt, and response in the headline message", () => {
    logAiInvocation(logger, {
      modelKey: "gpt-5-nano",
      purpose: "criterion_judge",
      prompt: "Judge this answer",
      response: "The answer is correct",
    });

    expect(infoMock).toHaveBeenCalledTimes(1);
    const [message] = infoMock.mock.calls[0] as [string, unknown];
    expect(message).toBe(
      "[gpt-5-nano] CRITERION_JUDGE - Judge this answer ; The answer is correct",
    );
  });

  it("upper-cases the purpose label", () => {
    logAiInvocation(logger, {
      modelKey: "gpt-4o-mini",
      purpose: "translation",
      prompt: "p",
      response: "r",
    });

    const [message] = infoMock.mock.calls[0] as [string, unknown];
    expect(message).toContain("[gpt-4o-mini] TRANSLATION");
  });

  it("truncates oversized prompts and responses but reports full lengths", () => {
    const prompt = "a".repeat(5000);
    const response = "b".repeat(6000);

    logAiInvocation(logger, {
      modelKey: "gpt-5-mini",
      purpose: "text_grading",
      prompt,
      response,
    });

    const [message, meta] = infoMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(message.length).toBeLessThan(5000);
    expect(message).toContain("truncated");
    expect(meta.prompt_length).toBe(5000);
    expect(meta.response_length).toBe(6000);
  });

  it("passes extra structured context through to the logger", () => {
    logAiInvocation(logger, {
      modelKey: "gpt-4o",
      purpose: "question_generation",
      prompt: "p",
      response: "r",
      context: { assignment_id: 42 },
    });

    const [, meta] = infoMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(meta).toMatchObject({
      model: "gpt-4o",
      purpose: "QUESTION_GENERATION",
      assignment_id: 42,
    });
  });
});
