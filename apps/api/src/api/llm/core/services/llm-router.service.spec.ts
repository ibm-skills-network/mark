import { DEFAULT_LLM_MODEL } from "../../llm.constants";
import { IMultimodalLlmProvider } from "../interfaces/llm-provider.interface";
import { Gpt6LunaLlmService } from "./gpt6-luna-llm.service";
import { LLMResolverService } from "./llm-resolver.service";
import { LlmRouter } from "./llm-router.service";

const provider = (key: string) => ({ key }) as IMultimodalLlmProvider;

const makeRouter = (resolved: string | null) => {
  const resolver = {
    resolveModelForFeature: jest.fn().mockResolvedValue(resolved),
    getModelKeyWithFallback: jest
      .fn()
      .mockImplementation((_feature: string, fallback: string) =>
        Promise.resolve(resolved ?? fallback),
      ),
  };
  const router = new LlmRouter(
    [provider("gpt-4o"), provider(DEFAULT_LLM_MODEL), provider("gpt-4o-mini")],
    resolver as unknown as LLMResolverService,
  );
  return { router, resolver };
};

describe("LlmRouter default model", () => {
  it("defaults to the Luna 6 provider", () => {
    expect(DEFAULT_LLM_MODEL).toBe(Gpt6LunaLlmService.MODEL);
  });

  it("returns the default model regardless of registration order", () => {
    expect(makeRouter(null).router.getDefault().key).toBe(DEFAULT_LLM_MODEL);
  });

  it("uses the default model when a feature has no assignment", async () => {
    const { router } = makeRouter(null);
    expect((await router.getForFeature("text_grading")).key).toBe(
      DEFAULT_LLM_MODEL,
    );
    expect((await router.getForFeatureWithFallback("text_grading")).key).toBe(
      DEFAULT_LLM_MODEL,
    );
  });

  it("falls back to the default when the assigned model has no provider", async () => {
    const { router } = makeRouter("retired-model");
    expect((await router.getForFeature("text_grading")).key).toBe(
      DEFAULT_LLM_MODEL,
    );
  });

  it("prefers the feature's assigned model", async () => {
    const { router } = makeRouter("gpt-4o-mini");
    expect((await router.getForFeatureWithFallback("text_grading")).key).toBe(
      "gpt-4o-mini",
    );
  });
});
