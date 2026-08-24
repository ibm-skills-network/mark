import { Inject, Injectable } from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { TOKEN_COUNTER } from "../../llm.constants";
import { ITokenCounter } from "../interfaces/token-counter.interface";
import { EffortNoneOpenAiLlmService } from "./openai-effort-none-llm.base";

/**
 * GPT-5.6: Luna (high volume), Terra (mid) and Sol (flagship). Identical
 * 1.05M/922K/128K limits and capabilities; they differ only in slug and price.
 *
 * Admin-selectable only -- no feature defaults to these. Two things to know
 * before making one a default:
 *
 * - These are rolling slugs with no dated snapshot, so a backend can change
 *   under a stable slug. Bump GRADING_CACHE_REVISION at that point.
 * - Sol costs 25x Luna on output. Check pricing before a high-volume feature.
 */
@Injectable()
export class Gpt56LunaLlmService extends EffortNoneOpenAiLlmService {
  static readonly MODEL = "gpt-5.6-luna";
  readonly key = Gpt56LunaLlmService.MODEL;
  // GPT-5.6 caches only at explicit breakpoints; earlier models 400 on the
  // parameters that enable them.
  readonly supportsExplicitPromptCache = true;

  constructor(
    @Inject(TOKEN_COUNTER) tokenCounter: ITokenCounter,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    super(Gpt56LunaLlmService.MODEL, tokenCounter, parentLogger);
  }
}

@Injectable()
export class Gpt56TerraLlmService extends EffortNoneOpenAiLlmService {
  static readonly MODEL = "gpt-5.6-terra";
  readonly key = Gpt56TerraLlmService.MODEL;
  // GPT-5.6 caches only at explicit breakpoints; earlier models 400 on the
  // parameters that enable them.
  readonly supportsExplicitPromptCache = true;

  constructor(
    @Inject(TOKEN_COUNTER) tokenCounter: ITokenCounter,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    super(Gpt56TerraLlmService.MODEL, tokenCounter, parentLogger);
  }
}

@Injectable()
export class Gpt56SolLlmService extends EffortNoneOpenAiLlmService {
  static readonly MODEL = "gpt-5.6-sol";
  readonly key = Gpt56SolLlmService.MODEL;
  // GPT-5.6 caches only at explicit breakpoints; earlier models 400 on the
  // parameters that enable them.
  readonly supportsExplicitPromptCache = true;

  constructor(
    @Inject(TOKEN_COUNTER) tokenCounter: ITokenCounter,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    super(Gpt56SolLlmService.MODEL, tokenCounter, parentLogger);
  }
}
