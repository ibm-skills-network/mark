import { Logger } from "winston";
import { ITokenCounter } from "../interfaces/token-counter.interface";
import { Gpt6LunaLlmService } from "./gpt6-luna-llm.service";
import { Gpt61SolLlmService, Gpt61TerraLlmService } from "./gpt61-llm.service";

const tokenCounter = { countTokens: () => 0 } as unknown as ITokenCounter;
const logger = { child: () => logger } as unknown as Logger;

describe("explicit prompt-cache capability", () => {
  it.each([
    ["Gpt6LunaLlmService", new Gpt6LunaLlmService(tokenCounter, logger)],
    ["Gpt61TerraLlmService", new Gpt61TerraLlmService(tokenCounter, logger)],
    ["Gpt61SolLlmService", new Gpt61SolLlmService(tokenCounter, logger)],
  ])("%s opts in", (_name, provider) => {
    expect(provider.supportsExplicitPromptCache).toBe(true);
  });
});
