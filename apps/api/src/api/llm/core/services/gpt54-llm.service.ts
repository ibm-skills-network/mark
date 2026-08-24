import { Inject, Injectable } from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { TOKEN_COUNTER } from "../../llm.constants";
import { ITokenCounter } from "../interfaces/token-counter.interface";
import { EffortNoneOpenAiLlmService } from "./openai-effort-none-llm.base";

@Injectable()
export class Gpt54MiniLlmService extends EffortNoneOpenAiLlmService {
  static readonly MODEL = "gpt-5.4-mini-2026-03-17";
  readonly key = Gpt54MiniLlmService.MODEL;

  constructor(
    @Inject(TOKEN_COUNTER) tokenCounter: ITokenCounter,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    super(Gpt54MiniLlmService.MODEL, tokenCounter, parentLogger);
  }
}

@Injectable()
export class Gpt54NanoLlmService extends EffortNoneOpenAiLlmService {
  static readonly MODEL = "gpt-5.4-nano-2026-03-17";
  readonly key = Gpt54NanoLlmService.MODEL;

  constructor(
    @Inject(TOKEN_COUNTER) tokenCounter: ITokenCounter,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    super(Gpt54NanoLlmService.MODEL, tokenCounter, parentLogger);
  }
}
