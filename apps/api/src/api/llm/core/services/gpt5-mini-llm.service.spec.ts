import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { Gpt5MiniLlmService } from "./gpt5-mini-llm.service";

jest.mock("@langchain/openai", () => ({
  ChatOpenAI: jest.fn().mockImplementation(() => ({
    invoke: jest.fn().mockResolvedValue({ content: "ok" }),
  })),
}));

describe("Gpt5MiniLlmService.invokeStructured", () => {
  const schema = z.object({ grade: z.number() });

  const makeService = () => {
    const tokenCounter = { countTokens: jest.fn().mockReturnValue(42) };
    const logger = { child: jest.fn(), info: jest.fn(), error: jest.fn() };
    logger.child.mockReturnValue(logger);
    return new Gpt5MiniLlmService(tokenCounter as never, logger as never);
  };

  beforeEach(() => {
    (ChatOpenAI as unknown as jest.Mock).mockClear();
  });

  it("binds the schema via withStructuredOutput and returns the parsed object", async () => {
    const structuredInvoke = jest.fn().mockResolvedValue({
      raw: { usage_metadata: { input_tokens: 30, output_tokens: 8 } },
      parsed: { grade: 6 },
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
    expect(result.parsed).toEqual({ grade: 6 });
    expect(result.tokenUsage).toEqual({ input: 30, output: 8 });
  });
});
