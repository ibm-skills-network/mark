import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { Gpt61SolLlmService, Gpt61TerraLlmService } from "./gpt61-llm.service";
import { Gpt6LunaLlmService } from "./gpt6-luna-llm.service";

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
  ["Gpt6LunaLlmService", Gpt6LunaLlmService],
  ["Gpt61TerraLlmService", Gpt61TerraLlmService],
  ["Gpt61SolLlmService", Gpt61SolLlmService],
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

// GPT-6 reasons at `medium` unless told otherwise, and a slug copy-paste
// slip between the three would grade at the wrong price tier.
const GPT6_PROVIDERS = [
  ["Gpt6LunaLlmService", Gpt6LunaLlmService, "gpt-6-luna", "none"],
  ["Gpt61TerraLlmService", Gpt61TerraLlmService, "gpt-6.1-terra", "none"],
  ["Gpt61SolLlmService", Gpt61SolLlmService, "gpt-6.1-sol", "low"],
] as const;

describe.each(GPT6_PROVIDERS)("%s", (_name, Provider, expectedSlug, effort) => {
  beforeEach(() => {
    (ChatOpenAI as unknown as jest.Mock).mockClear();
  });

  it(`invokes the exact ${expectedSlug} slug with supported reasoning effort`, async () => {
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
        modelKwargs: expect.objectContaining({ reasoning_effort: effort }),
      }),
    );
  });
});

it("gives the Luna 6 and GPT-6 variants distinct provider keys", () => {
  const keys = GPT6_PROVIDERS.map(([, , slug]) => slug);
  expect(new Set(keys).size).toBe(3);
});

describe("GPT-6 token usage", () => {
  const makeLunaService = (countTokens: jest.Mock) => {
    const logger = {
      child: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    logger.child.mockReturnValue(logger);
    return new Gpt6LunaLlmService({ countTokens } as never, logger as never);
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
