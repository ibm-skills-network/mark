import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { Gpt6LunaLlmService } from "./gpt6-luna-llm.service";

// Exercise the real SDK serializer: mocking ChatOpenAI misses the GPT-6
// max_tokens regression (the SDK only recognizes GPT-5/o-series).
describe("GPT-6 Luna wire parameters", () => {
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
        const service = new Gpt6LunaLlmService(
          { countTokens: () => 1 },
          logger as never,
        );
        await service.invoke([new HumanMessage("hi")], { maxTokens: limit });
        expect(wire?.model).toBe("gpt-6-luna");
        expect(wire?.reasoning_effort).toBe("none");
        expect(wire?.max_completion_tokens).toBe(limit ?? 4096);
        expect(wire?.max_tokens).toBeUndefined();
      } finally {
        invoke.mockRestore();
      }
    },
  );
});
