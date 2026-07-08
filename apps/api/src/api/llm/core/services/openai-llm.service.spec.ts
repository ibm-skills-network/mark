import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { OpenAiLlmService } from "./openai-llm.service";

jest.mock("@langchain/openai", () => ({
  ChatOpenAI: jest.fn().mockImplementation(() => ({
    invoke: jest.fn().mockResolvedValue({ content: "ok" }),
  })),
}));

describe("OpenAiLlmService request options", () => {
  const makeService = () => {
    const tokenCounter = { countTokens: jest.fn().mockReturnValue(1) };
    const logger = {
      child: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
    };
    logger.child.mockReturnValue(logger);

    return new OpenAiLlmService(tokenCounter as never, logger as never);
  };

  beforeEach(() => {
    (ChatOpenAI as unknown as jest.Mock).mockClear();
  });

  it("forwards timeoutMs and maxRetries to the ChatOpenAI client", async () => {
    const service = makeService();

    await service.invoke([new HumanMessage("hi")], {
      modelName: "gpt-4o-mini",
      timeoutMs: 60_000,
      maxRetries: 1,
    });

    expect(ChatOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        timeout: 60_000,
        maxRetries: 1,
      }),
    );
  });

  it("leaves client timeout and retries at SDK defaults when not requested", async () => {
    const service = makeService();

    await service.invoke([new HumanMessage("hi")], {
      modelName: "gpt-4o-mini",
    });

    const [config] = (ChatOpenAI as unknown as jest.Mock).mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(config.timeout).toBeUndefined();
    expect(config.maxRetries).toBeUndefined();
  });
});

describe("OpenAiLlmService.invokeStructured", () => {
  const schema = z.object({ grade: z.number() });

  const makeService = () => {
    const tokenCounter = { countTokens: jest.fn().mockReturnValue(99) };
    const logger = { child: jest.fn(), info: jest.fn(), error: jest.fn() };
    logger.child.mockReturnValue(logger);
    return new OpenAiLlmService(tokenCounter as never, logger as never);
  };

  beforeEach(() => {
    (ChatOpenAI as unknown as jest.Mock).mockClear();
  });

  it("binds the schema via withStructuredOutput and returns the parsed object", async () => {
    const structuredInvoke = jest.fn().mockResolvedValue({
      raw: { usage_metadata: { input_tokens: 12, output_tokens: 7 } },
      parsed: { grade: 3 },
    });
    const withStructuredOutput = jest
      .fn()
      .mockReturnValue({ invoke: structuredInvoke });
    (ChatOpenAI as unknown as jest.Mock).mockImplementationOnce(() => ({
      invoke: jest.fn(),
      withStructuredOutput,
    }));
    const service = makeService();

    const result = await service.invokeStructured(
      [new HumanMessage("grade this")],
      schema,
      { maxRetries: 1 },
    );

    expect(withStructuredOutput).toHaveBeenCalledWith(
      schema,
      expect.objectContaining({ includeRaw: true }),
    );
    expect(structuredInvoke).toHaveBeenCalledTimes(1);
    expect(result.parsed).toEqual({ grade: 3 });
    expect(result.tokenUsage).toEqual({ input: 12, output: 7 });
  });

  it("propagates provider errors instead of swallowing them", async () => {
    const withStructuredOutput = jest.fn().mockReturnValue({
      invoke: jest.fn().mockRejectedValue(new Error("provider down")),
    });
    (ChatOpenAI as unknown as jest.Mock).mockImplementationOnce(() => ({
      invoke: jest.fn(),
      withStructuredOutput,
    }));
    const service = makeService();

    await expect(
      service.invokeStructured([new HumanMessage("grade this")], schema),
    ).rejects.toThrow("provider down");
  });
});
