import { ChatOpenAI } from "@langchain/openai";
import { Gpt61SolLlmService, Gpt61TerraLlmService } from "./gpt61-llm.service";
import { Gpt6LunaLlmService } from "./gpt6-luna-llm.service";

jest.mock("@langchain/openai", () => ({
  ChatOpenAI: jest.fn().mockImplementation(() => ({
    invoke: jest.fn().mockResolvedValue({ content: "ok" }),
  })),
}));

/**
 * A submission can carry several images. A provider that renders only the
 * first one grades a submission it was never shown the rest of — which is
 * indistinguishable, in the output, from the learner not having done the work.
 * Every vision-capable provider must render one image part per payload.
 */
const VISION_PROVIDERS = [
  ["Gpt6LunaLlmService", Gpt6LunaLlmService],
  ["Gpt61TerraLlmService", Gpt61TerraLlmService],
  ["Gpt61SolLlmService", Gpt61SolLlmService],
] as const;

const IMAGES = [
  "data:image/png;base64,AAAA",
  "data:image/png;base64,BBBB",
  "data:image/jpeg;base64,CCCC",
];

function makeService(Provider: (typeof VISION_PROVIDERS)[number][1]) {
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
}

function capturedContent(invoke: jest.Mock) {
  const [messages] = invoke.mock.calls[0] as [Array<{ content: unknown }>];
  return messages[0].content as Array<{
    type: string;
    image_url?: { url: string };
  }>;
}

describe.each(VISION_PROVIDERS)("%s multi-image input", (_name, Provider) => {
  beforeEach(() => {
    (ChatOpenAI as unknown as jest.Mock).mockClear();
  });

  it("renders one image part per payload", async () => {
    const invoke = jest.fn().mockResolvedValue({ content: "ok" });
    (ChatOpenAI as unknown as jest.Mock).mockImplementationOnce(() => ({
      invoke,
    }));

    await makeService(Provider).invokeWithImage("grade these", IMAGES);

    const content = capturedContent(invoke);
    const imageParts = content.filter((part) => part.type === "image_url");
    expect(imageParts).toHaveLength(3);
    expect(imageParts.map((part) => part.image_url?.url)).toEqual(IMAGES);
    expect(content[0]).toMatchObject({ type: "text", text: "grade these" });
  });

  it("still accepts a single string payload", async () => {
    const invoke = jest.fn().mockResolvedValue({ content: "ok" });
    (ChatOpenAI as unknown as jest.Mock).mockImplementationOnce(() => ({
      invoke,
    }));

    await makeService(Provider).invokeWithImage("grade this", IMAGES[0]);

    const imageParts = capturedContent(invoke).filter(
      (part) => part.type === "image_url",
    );
    expect(imageParts).toHaveLength(1);
    expect(imageParts[0].image_url?.url).toBe(IMAGES[0]);
  });

  it("drops blank payloads rather than sending an empty image url", async () => {
    const invoke = jest.fn().mockResolvedValue({ content: "ok" });
    (ChatOpenAI as unknown as jest.Mock).mockImplementationOnce(() => ({
      invoke,
    }));

    await makeService(Provider).invokeWithImage("grade these", [
      IMAGES[0],
      "",
      "   ",
      IMAGES[1],
    ]);

    const imageParts = capturedContent(invoke).filter(
      (part) => part.type === "image_url",
    );
    expect(imageParts).toHaveLength(2);
  });
});
