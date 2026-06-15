import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
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
