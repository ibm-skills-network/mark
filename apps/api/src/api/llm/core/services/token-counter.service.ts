import { get_encoding, Tiktoken } from "@dqbd/tiktoken";
import { Inject, Injectable } from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { ITokenCounter } from "../interfaces/token-counter.interface";

@Injectable()
export class TokenCounterService implements ITokenCounter {
  private readonly encoding: Tiktoken;
  private readonly logger: Logger;

  constructor(@Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger) {
    this.logger = parentLogger.child({ context: TokenCounterService.name });

    this.encoding = get_encoding("gpt2");
  }

  /**
   * Count the number of tokens in the given text
   */
  countTokens(text: string, modelKey?: string): number {
    if (!text) return 0;

    try {
      if (modelKey?.includes("llama")) {
        return this.countLlamaTokens(text);
      }
      return this.encoding.encode(text, [modelKey]).length;
    } catch (error) {
      this.logger.error(
        `Error encoding text for model ${modelKey}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      return Math.ceil(text.length / 4);
    }
  }

  /**
   * Count tokens for Llama models (rough approximation)
   * Llama models typically use a similar tokenization to GPT, so we use the same encoding
   * but could be refined with actual Llama tokenizer if needed
   */
  private countLlamaTokens(text: string): number {
    try {
      return this.encoding.encode(text).length;
    } catch {
      return Math.ceil(text.length / 4);
    }
  }
}
