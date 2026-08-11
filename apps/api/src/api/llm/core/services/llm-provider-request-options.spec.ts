import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { Gpt54MiniLlmService } from "./gpt54-llm.service";
import {
  Gpt56LunaLlmService,
  Gpt56SolLlmService,
  Gpt56TerraLlmService,
} from "./gpt56-llm.service";
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
  ["Gpt54MiniLlmService", Gpt54MiniLlmService],
  ["Gpt56LunaLlmService", Gpt56LunaLlmService],
  ["Gpt56TerraLlmService", Gpt56TerraLlmService],
  ["Gpt56SolLlmService", Gpt56SolLlmService],
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

  it("forwards safetyIdentifier as modelKwargs.safety_identifier", async () => {
    const service = makeService();

    await service.invoke([new HumanMessage("hi")], {
      safetyIdentifier: "abc123",
    });

    expect(ChatOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        modelKwargs: expect.objectContaining({ safety_identifier: "abc123" }),
      }),
    );
  });
});

// GPT-5.6 reasons at `medium` unless told otherwise, and a slug copy-paste
// slip between the three would grade at the wrong price tier.
const GPT56_PROVIDERS = [
  ["Gpt56LunaLlmService", Gpt56LunaLlmService, "gpt-5.6-luna"],
  ["Gpt56TerraLlmService", Gpt56TerraLlmService, "gpt-5.6-terra"],
  ["Gpt56SolLlmService", Gpt56SolLlmService, "gpt-5.6-sol"],
] as const;

describe.each(GPT56_PROVIDERS)("%s", (_name, Provider, expectedSlug) => {
  beforeEach(() => {
    (ChatOpenAI as unknown as jest.Mock).mockClear();
  });

  it(`invokes the exact ${expectedSlug} slug with reasoning disabled`, async () => {
    const tokenCounter = { countTokens: jest.fn().mockReturnValue(1) };
    const logger = {
      child: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    logger.child.mockReturnValue(logger);
    const service = new Provider(tokenCounter as never, logger as never);

    expect(service.key).toBe(expectedSlug);

    await service.invoke([new HumanMessage("hi")]);

    expect(ChatOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        modelName: expectedSlug,
        modelKwargs: expect.objectContaining({ reasoning_effort: "none" }),
      }),
    );
  });
});

it("gives the three GPT-5.6 variants distinct provider keys", () => {
  const keys = GPT56_PROVIDERS.map(([, , slug]) => slug);
  expect(new Set(keys).size).toBe(3);
});

describe("GPT-5.6 token usage", () => {
  const makeLunaService = (countTokens: jest.Mock) => {
    const logger = {
      child: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    logger.child.mockReturnValue(logger);
    return new Gpt56LunaLlmService({ countTokens } as never, logger as never);
  };

  beforeEach(() => {
    (ChatOpenAI as unknown as jest.Mock).mockClear();
  });

  it("uses provider-reported image tokens instead of counting Base64 as text", async () => {
    const invoke = jest.fn().mockResolvedValue({
      content: "ok",
      usage_metadata: { input_tokens: 4321, output_tokens: 17 },
    });
    (ChatOpenAI as unknown as jest.Mock).mockImplementationOnce(() => ({
      invoke,
    }));
    const countTokens = jest.fn().mockReturnValue(3);
    const service = makeLunaService(countTokens);

    const result = await service.invokeWithImage(
      "Describe the image",
      "A".repeat(20_000),
    );

    expect(result.tokenUsage).toEqual({ input: 4321, output: 17 });
    expect(countTokens).toHaveBeenCalledTimes(1);
    expect(countTokens).toHaveBeenCalledWith("Describe the image");
  });

  it("uses a bounded image estimate when the provider omits usage metadata", async () => {
    const invoke = jest.fn().mockResolvedValue({ content: "ok" });
    (ChatOpenAI as unknown as jest.Mock).mockImplementationOnce(() => ({
      invoke,
    }));
    const countTokens = jest
      .fn()
      .mockImplementation((value: string) =>
        value === "Describe the image" ? 7 : 2,
      );
    const service = makeLunaService(countTokens);

    const result = await service.invokeWithImage(
      "Describe the image",
      "B".repeat(20_000),
    );

    expect(result.tokenUsage).toEqual({ input: 207, output: 2 });
    expect(
      countTokens.mock.calls.every(
        ([value]) => typeof value === "string" && !value.includes("BBBB"),
      ),
    ).toBe(true);
  });
});

describe("Gpt54MiniLlmService modelKwargs merge", () => {
  beforeEach(() => {
    (ChatOpenAI as unknown as jest.Mock).mockClear();
  });

  it("keeps reasoning_effort alongside safety_identifier", async () => {
    const tokenCounter = { countTokens: jest.fn().mockReturnValue(1) };
    const logger = {
      child: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    logger.child.mockReturnValue(logger);
    const service = new Gpt54MiniLlmService(
      tokenCounter as never,
      logger as never,
    );

    await service.invoke([new HumanMessage("hi")], {
      safetyIdentifier: "abc123",
    });

    expect(ChatOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        modelKwargs: expect.objectContaining({
          reasoning_effort: "none",
          safety_identifier: "abc123",
        }),
      }),
    );
  });
});
