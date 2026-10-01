import { Inject, Injectable } from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { TOKEN_COUNTER } from "../../llm.constants";
import { ITokenCounter } from "../interfaces/token-counter.interface";
import { EffortNoneOpenAiLlmService } from "./openai-effort-none-llm.base";

/** GPT-6 Luna keeps the existing non-reasoning grading contract. */
@Injectable()
export class Gpt6LunaLlmService extends EffortNoneOpenAiLlmService {
  static readonly MODEL = "gpt-6-luna";
  readonly key = Gpt6LunaLlmService.MODEL;
  readonly supportsExplicitPromptCache = true;
  protected readonly explicitCompletionTokenLimit = true;

  constructor(
    @Inject(TOKEN_COUNTER) tokenCounter: ITokenCounter,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    super(Gpt6LunaLlmService.MODEL, tokenCounter, parentLogger);
  }
}
