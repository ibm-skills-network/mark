import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { invokeStructuredChatModel } from "./structured-output.util";

describe("invokeStructuredChatModel", () => {
  const schema = z.object({ grade: z.number() });
  const makeLogger = () => ({ info: jest.fn(), error: jest.fn() });

  it("binds the schema and returns parsed + usage from raw.usage_metadata", async () => {
    const structuredInvoke = jest.fn().mockResolvedValue({
      raw: { usage_metadata: { input_tokens: 11, output_tokens: 6 } },
      parsed: { grade: 7 },
    });
    const withStructuredOutput = jest
      .fn()
      .mockReturnValue({ invoke: structuredInvoke });
    const model = { withStructuredOutput } as never;
    const tokenCounter = { countTokens: jest.fn().mockReturnValue(3) };
    const logger = makeLogger();

    const result = await invokeStructuredChatModel(
      model,
      [new HumanMessage("grade this")],
      schema,
      tokenCounter as never,
      logger as never,
      "gpt-5-mini",
    );

    expect(withStructuredOutput).toHaveBeenCalledWith(
      schema,
      expect.objectContaining({ includeRaw: true }),
    );
    expect(result).toEqual({
      parsed: { grade: 7 },
      tokenUsage: { input: 11, output: 6 },
    });
  });

  it("falls back to counting tokens when usage metadata is absent", async () => {
    const structuredInvoke = jest
      .fn()
      .mockResolvedValue({ raw: {}, parsed: { grade: 1 } });
    const model = {
      withStructuredOutput: jest
        .fn()
        .mockReturnValue({ invoke: structuredInvoke }),
    } as never;
    const tokenCounter = { countTokens: jest.fn().mockReturnValue(5) };

    const result = await invokeStructuredChatModel(
      model,
      [new HumanMessage("x")],
      schema,
      tokenCounter as never,
      makeLogger() as never,
      "gpt-5-mini",
    );

    expect(result.tokenUsage).toEqual({ input: 5, output: 5 });
  });

  it("logs and rethrows provider errors", async () => {
    const model = {
      withStructuredOutput: jest.fn().mockReturnValue({
        invoke: jest.fn().mockRejectedValue(new Error("boom")),
      }),
    } as never;
    const logger = makeLogger();

    await expect(
      invokeStructuredChatModel(
        model,
        [new HumanMessage("x")],
        schema,
        { countTokens: () => 1 } as never,
        logger as never,
        "gpt-5-mini",
      ),
    ).rejects.toThrow("boom");
    expect(logger.error).toHaveBeenCalled();
  });
});
