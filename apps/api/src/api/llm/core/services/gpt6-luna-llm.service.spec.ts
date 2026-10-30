import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { Gpt61SolLlmService, Gpt61TerraLlmService } from "./gpt61-llm.service";
import { getModelReasoningEffort } from "../utils/model-reasoning.util";
import { Gpt6LunaLlmService } from "./gpt6-luna-llm.service";

// Exercise the real SDK serializer: mocking ChatOpenAI misses the GPT-6
// max_tokens regression (the SDK only recognizes GPT-5/o-series).
describe.each([
  ["gpt-6-luna", Gpt6LunaLlmService, "none"],
  ["gpt-6.1-terra", Gpt61TerraLlmService, "none"],
  ["gpt-6.1-sol", Gpt61SolLlmService, "low"],
] as const)("%s wire parameters", (model, Provider, effort) => {
  it("uses native JSON schema output without Chat Completions tool calls", async () => {
    let wire: Record<string, unknown> | undefined;
    const invoke = jest
      .spyOn(ChatOpenAI.prototype, "invoke")
      .mockImplementation(function (this: ChatOpenAI, _input, options) {
        wire = this.invocationParams(options);
        return Promise.resolve(
          new AIMessage({
            content: '{"grade":2}',
            usage_metadata: {
              input_tokens: 10,
              output_tokens: 5,
              total_tokens: 15,
            },
          }),
        );
      });
    const logger = {
      child: jest.fn().mockReturnThis(),
      info: jest.fn(),
      error: jest.fn(),
    };
    try {
      const service = new Provider({ countTokens: () => 1 }, logger as never);
      const result = await service.invokeStructured(
        [new HumanMessage("grade this")],
        z.object({ grade: z.number() }),
      );
      expect(result.parsed).toEqual({ grade: 2 });
      expect(wire?.response_format).toMatchObject({ type: "json_schema" });
      expect(wire?.tools).toBeUndefined();
      expect(wire?.reasoning_effort).toBe(effort);
    } finally {
      invoke.mockRestore();
    }
  });

  it.each([undefined, 731])(
    "uses max_completion_tokens with limit %s",
    async (limit) => {
      let wire: Record<string, unknown> | undefined;
      const invoke = jest
        .spyOn(ChatOpenAI.prototype, "invoke")
        .mockImplementation(function (this: ChatOpenAI) {
          wire = this.invocationParams();
          return Promise.resolve({
            content: "ok",
            usage_metadata: { input_tokens: 10, output_tokens: 2 },
          }) as never;
        });
      const logger = { child: jest.fn().mockReturnThis() };
      try {
        const service = new Provider({ countTokens: () => 1 }, logger as never);
        await service.invoke([new HumanMessage("hi")], { maxTokens: limit });
        expect(wire?.model).toBe(model);
        expect(wire?.reasoning_effort).toBe(effort);
        expect(wire?.max_completion_tokens).toBe(limit ?? 4096);
        expect(wire?.max_tokens).toBeUndefined();
        expect(wire?.temperature).toBeUndefined();
        expect(wire?.top_p).toBeUndefined();
        expect(getModelReasoningEffort(model)).toBe(wire?.reasoning_effort);
      } finally {
        invoke.mockRestore();
      }
    },
  );
});
