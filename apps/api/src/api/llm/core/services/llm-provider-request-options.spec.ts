import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { Gpt5LlmService } from "./gpt5-llm.service";
import { Gpt5MiniLlmService } from "./gpt5-mini-llm.service";
import { Gpt5NanoLlmService } from "./gpt5-nano-llm.service";
import { Gpt4VisionPreviewLlmService } from "./openai-llm-vision.service";
import { OpenAiLlmMiniService } from "./openai-llm-mini.service";

jest.mock("@langchain/openai", () => ({
  ChatOpenAI: jest.fn().mockImplementation(() => ({
    invoke: jest.fn().mockResolvedValue({ content: "ok" }),
  })),
}));

// Every ChatOpenAI-backed provider must forward the caller's request
// options to the client; a provider that drops them silently reverts to
// the SDK's 10-minute default timeout for callers that asked to fail
// fast (the translation retry path depends on this).
const PROVIDERS = [
  ["Gpt5LlmService", Gpt5LlmService],
  ["Gpt5MiniLlmService", Gpt5MiniLlmService],
  ["Gpt5NanoLlmService", Gpt5NanoLlmService],
  ["Gpt4VisionPreviewLlmService", Gpt4VisionPreviewLlmService],
  ["OpenAiLlmMiniService", OpenAiLlmMiniService],
] as const;

describe.each(PROVIDERS)("%s request options", (_name, Provider) => {
  const makeService = () => {
    const tokenCounter = { countTokens: jest.fn().mockReturnValue(1) };
    const logger = {
      child: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    logger.child.mockReturnValue(logger);

    return new Provider(tokenCounter as never, logger as never);
  };

  beforeEach(() => {
    (ChatOpenAI as unknown as jest.Mock).mockClear();
  });

  it("forwards timeoutMs and maxRetries to the ChatOpenAI client", async () => {
    const service = makeService();

    await service.invoke([new HumanMessage("hi")], {
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

    await service.invoke([new HumanMessage("hi")]);

    const [config] = (ChatOpenAI as unknown as jest.Mock).mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(config.timeout).toBeUndefined();
    expect(config.maxRetries).toBeUndefined();
  });
});
