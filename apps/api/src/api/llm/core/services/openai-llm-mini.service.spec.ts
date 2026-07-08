import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { OpenAiLlmMiniService } from "./openai-llm-mini.service";

jest.mock("@langchain/openai", () => ({
  ChatOpenAI: jest.fn().mockImplementation(() => ({
    invoke: jest.fn().mockResolvedValue({ content: "ok" }),
  })),
}));

describe("OpenAiLlmMiniService.invokeStructured", () => {
  const schema = z.object({ grade: z.number() });

  const makeService = () => {
    const tokenCounter = { countTokens: jest.fn().mockReturnValue(42) };
    const logger = { child: jest.fn(), info: jest.fn(), error: jest.fn() };
    logger.child.mockReturnValue(logger);
    return new OpenAiLlmMiniService(tokenCounter as never, logger as never);
  };

  beforeEach(() => {
    (ChatOpenAI as unknown as jest.Mock).mockClear();
  });

  it("binds the schema via withStructuredOutput and returns the parsed object", async () => {
    const structuredInvoke = jest.fn().mockResolvedValue({
      raw: { usage_metadata: { input_tokens: 20, output_tokens: 9 } },
      parsed: { grade: 5 },
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
    expect(result.parsed).toEqual({ grade: 5 });
    expect(result.tokenUsage).toEqual({ input: 20, output: 9 });
  });

  it("falls back to counting tokens when usage metadata is absent", async () => {
    const structuredInvoke = jest
      .fn()
      .mockResolvedValue({ raw: {}, parsed: { grade: 1 } });
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
    );

    // countTokens is stubbed to 42 for both input text and serialized output.
    expect(result.tokenUsage).toEqual({ input: 42, output: 42 });
  });
});
