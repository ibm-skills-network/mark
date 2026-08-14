import { Logger } from "winston";
import { ITokenCounter } from "../interfaces/token-counter.interface";
import { Gpt54MiniLlmService, Gpt54NanoLlmService } from "./gpt54-llm.service";
import {
  Gpt56LunaLlmService,
  Gpt56SolLlmService,
  Gpt56TerraLlmService,
} from "./gpt56-llm.service";

/**
 * GPT-5.4 and GPT-5.6 share a provider base class, but only GPT-5.6 accepts
 * the explicit-cache parameters — every other OpenAI model answers a request
 * carrying `prompt_cache_options` with a 400. Since these providers back the
 * whole grading pipeline, a flag set on the wrong class fails every grading
 * call rather than merely losing the discount.
 */

const tokenCounter = { countTokens: () => 0 } as unknown as ITokenCounter;
const logger = { child: () => logger } as unknown as Logger;

describe("explicit prompt-cache capability", () => {
  it.each([
    ["Gpt56LunaLlmService", new Gpt56LunaLlmService(tokenCounter, logger)],
    ["Gpt56TerraLlmService", new Gpt56TerraLlmService(tokenCounter, logger)],
    ["Gpt56SolLlmService", new Gpt56SolLlmService(tokenCounter, logger)],
  ])("%s opts in", (_name, provider) => {
    expect(provider.supportsExplicitPromptCache).toBe(true);
  });

  it.each([
    ["Gpt54MiniLlmService", new Gpt54MiniLlmService(tokenCounter, logger)],
    ["Gpt54NanoLlmService", new Gpt54NanoLlmService(tokenCounter, logger)],
  ])("%s stays out", (_name, provider) => {
    expect(provider.supportsExplicitPromptCache).toBe(false);
  });
});
