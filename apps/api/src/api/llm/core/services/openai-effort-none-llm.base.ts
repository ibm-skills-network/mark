import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import type { ZodTypeAny } from "zod";
import { Logger } from "winston";
import {
  IMultimodalLlmProvider,
  LlmRequestOptions,
  LlmResponse,
  LlmStructuredResponse,
} from "../interfaces/llm-provider.interface";
import { ITokenCounter } from "../interfaces/token-counter.interface";
import { invokeStructuredChatModel } from "./structured-output.util";
import { safetyIdentifierKwargs } from "../utils/safety-identifier.util";
import { explicitPromptCacheKwargs } from "../utils/prompt-cache.util";

/**
 * Shared base for OpenAI providers pinned to `reasoning_effort: "none"`.
 *
 * FileGradingService hashes `reasoningEffort: "none"` into the grade cache key
 * as a literal instead of reading it from the provider, so reasoning at any
 * other level here silently collides with grades produced at `none`.
 */
export abstract class EffortNoneOpenAiLlmService
  implements IMultimodalLlmProvider
{
  private static readonly FALLBACK_IMAGE_TOKENS = 200;
  protected readonly logger: Logger;
  abstract readonly key: string;

  /**
   * Off by default. GPT-5.4 shares this base and rejects the explicit-cache
   * parameters with a 400, so only the GPT-5.6 subclasses opt in.
   */
  readonly supportsExplicitPromptCache: boolean = false;

  protected constructor(
    private readonly modelName: string,
    private readonly tokenCounter: ITokenCounter,
    parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({
      context: this.constructor.name,
      modelName,
    });
  }

  private createChatModel(options?: LlmRequestOptions): ChatOpenAI {
    return new ChatOpenAI({
      // Not overridable per call: the key is the grading cache identity.
      modelName: this.modelName,
      // Installed SDK types predate `none`, so go through modelKwargs.
      modelKwargs: {
        reasoning_effort: "none",
        ...safetyIdentifierKwargs(options),
        ...(this.supportsExplicitPromptCache
          ? explicitPromptCacheKwargs(options)
          : {}),
      },
      maxCompletionTokens: options?.maxTokens ?? 4096,
      timeout: options?.timeoutMs,
      maxRetries: options?.maxRetries,
    });
  }

  async invoke(
    messages: HumanMessage[],
    options?: LlmRequestOptions,
  ): Promise<LlmResponse> {
    const inputText = messages
      .map((message) =>
        typeof message.content === "string"
          ? message.content
          : JSON.stringify(message.content),
      )
      .join("\n");
    return this.invokeWithUsageFallback(
      messages,
      this.tokenCounter.countTokens(inputText),
      options,
    );
  }

  private async invokeWithUsageFallback(
    messages: HumanMessage[],
    fallbackInputTokens: number,
    options?: LlmRequestOptions,
  ): Promise<LlmResponse> {
    const result = await this.createChatModel(options).invoke(messages);
    const content = result.content.toString();
    const usage = result.usage_metadata as
      | {
          input_tokens?: unknown;
          output_tokens?: unknown;
          input_token_details?: { cache_read?: unknown };
        }
      | undefined;
    const inputTokens =
      typeof usage?.input_tokens === "number"
        ? usage.input_tokens
        : fallbackInputTokens;
    const outputTokens =
      typeof usage?.output_tokens === "number"
        ? usage.output_tokens
        : this.tokenCounter.countTokens(content);
    const cacheRead = usage?.input_token_details?.cache_read;

    return {
      content,
      tokenUsage: {
        input: inputTokens,
        output: outputTokens,
        ...(typeof cacheRead === "number" ? { cachedInput: cacheRead } : {}),
      },
    };
  }

  async invokeStructured<T>(
    messages: HumanMessage[],
    schema: ZodTypeAny,
    options?: LlmRequestOptions,
  ): Promise<LlmStructuredResponse<T>> {
    return invokeStructuredChatModel<T>(
      this.createChatModel(options),
      messages,
      schema,
      this.tokenCounter,
      this.logger,
      this.key,
    );
  }

  async invokeWithImage(
    textContent: string,
    imageData: string,
    options?: LlmRequestOptions,
  ): Promise<LlmResponse> {
    if (!imageData) throw new Error("Image data is empty or null");
    const imageUrl = imageData.startsWith("data:")
      ? imageData
      : `data:image/jpeg;base64,${imageData}`;

    const message = new HumanMessage({
      content: [
        { type: "text", text: textContent },
        {
          type: "image_url",
          image_url: {
            url: imageUrl,
            detail: options?.imageDetail ?? "auto",
          },
        },
      ],
    });

    // API usage includes the model's image-token calculation. If an SDK or
    // mocked response omits it, use a bounded estimate without ever tokenizing
    // the Base64 payload as if it were prompt text.
    return this.invokeWithUsageFallback(
      [message],
      this.tokenCounter.countTokens(textContent) +
        EffortNoneOpenAiLlmService.FALLBACK_IMAGE_TOKENS,
      options,
    );
  }
}
