import { Inject, Injectable } from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { TOKEN_COUNTER } from "../../llm.constants";
import { ITokenCounter } from "../interfaces/token-counter.interface";
import { OpenAiLlmBase } from "./openai-llm.base";

@Injectable()
export class Gpt61TerraLlmService extends OpenAiLlmBase {
  static readonly MODEL = "gpt-6.1-terra";
  readonly key = Gpt61TerraLlmService.MODEL;
  readonly supportsExplicitPromptCache = true;
  protected readonly explicitCompletionTokenLimit = true;

  constructor(
    @Inject(TOKEN_COUNTER) tokenCounter: ITokenCounter,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    super(Gpt61TerraLlmService.MODEL, tokenCounter, parentLogger);
  }
}

@Injectable()
export class Gpt61SolLlmService extends OpenAiLlmBase {
  static readonly MODEL = "gpt-6.1-sol";
  readonly key = Gpt61SolLlmService.MODEL;
  readonly supportsExplicitPromptCache = true;
  protected readonly explicitCompletionTokenLimit = true;

  constructor(
    @Inject(TOKEN_COUNTER) tokenCounter: ITokenCounter,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    super(Gpt61SolLlmService.MODEL, tokenCounter, parentLogger);
  }
}
