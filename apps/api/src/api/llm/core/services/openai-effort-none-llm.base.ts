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
  protected readonly logger: Logger;
  abstract readonly key: string;

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
    const inputTokens = this.tokenCounter.countTokens(inputText);
    const result = await this.createChatModel(options).invoke(messages);
    const content = result.content.toString();

    return {
      content,
      tokenUsage: {
        input: inputTokens,
        output: this.tokenCounter.countTokens(content),
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

    return this.invoke(
      [
        new HumanMessage({
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
        }),
      ],
      options,
    );
  }
}
