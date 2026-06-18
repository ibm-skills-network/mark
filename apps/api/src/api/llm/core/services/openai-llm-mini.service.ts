import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { Inject, Injectable } from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import type { ZodTypeAny } from "zod";
import { TOKEN_COUNTER } from "../../llm.constants";
import {
  IMultimodalLlmProvider,
  LlmRequestOptions,
  LlmResponse,
  LlmStructuredResponse,
} from "../interfaces/llm-provider.interface";
import { ITokenCounter } from "../interfaces/token-counter.interface";
import { invokeStructuredChatModel } from "./structured-output.util";

/**
 * Light-weight provider that targets the smaller/faster gpt-4o-mini model.
 * Usage is identical to the full-size OpenAiLlmService.
 */
@Injectable()
export class OpenAiLlmMiniService implements IMultimodalLlmProvider {
  private readonly logger: Logger;
  static readonly DEFAULT_MODEL = "gpt-4o-mini";
  readonly key = "gpt-4o-mini";

  constructor(
    @Inject(TOKEN_COUNTER) private readonly tokenCounter: ITokenCounter,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: OpenAiLlmMiniService.name });
  }

  /** Create a ChatOpenAI instance with the given options */
  private createChatModel(options?: LlmRequestOptions): ChatOpenAI {
    return new ChatOpenAI({
      temperature: options?.temperature ?? 0,
      modelName: options?.modelName ?? OpenAiLlmMiniService.DEFAULT_MODEL,
      maxTokens: options?.maxTokens,
      timeout: options?.timeoutMs,
      maxRetries: options?.maxRetries,
    });
  }

  /** Standard text-only invocation */
  async invoke(
    messages: HumanMessage[],
    options?: LlmRequestOptions,
  ): Promise<LlmResponse> {
    const model = this.createChatModel(options);

    const inputText = messages
      .map((m) =>
        typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      )
      .join("\n");
    const inputTokens = this.tokenCounter.countTokens(inputText);
    const modelName = options?.modelName ?? OpenAiLlmMiniService.DEFAULT_MODEL;

    this.logger.info("openai.invoke.start", {
      model_name: modelName,
      input_tokens: inputTokens,
      input_full_length: inputText.length,
      input_snippet: inputText.slice(0, 400),
      message_count: messages.length,
      max_tokens: options?.maxTokens,
      temperature: options?.temperature ?? 0,
    });

    const start = Date.now();
    const result = await model.invoke(messages);
    const responseContent = result.content.toString();
    const outputTokens = this.tokenCounter.countTokens(responseContent);

    this.logger.info("openai.invoke.complete", {
      model_name: modelName,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      duration_ms: Date.now() - start,
      output_full_length: responseContent.length,
      output_snippet: responseContent.slice(0, 400),
    });

    return {
      content: responseContent,
      tokenUsage: { input: inputTokens, output: outputTokens },
    };
  }

  /**
   * Send a request and return a value validated against `schema` using the
   * model's native structured output. The model fills schema fields and the
   * SDK serializes the JSON, so the result is always valid JSON — unlike
   * free-form "respond with JSON" generation, which emits unescaped quotes /
   * control characters on code-heavy submissions and fails a strict parse.
   */
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
      options?.modelName ?? this.key,
    );
  }

  /** Invocation that includes an inline image */
  async invokeWithImage(
    textContent: string,
    imageData: string,
    options?: LlmRequestOptions,
  ): Promise<LlmResponse> {
    const model = this.createChatModel(options);
    const processedImageData = this.normalizeImageData(imageData);

    const textTokens = this.tokenCounter.countTokens(textContent);
    const estimatedImageTokens = 150;
    const modelName = options?.modelName ?? OpenAiLlmMiniService.DEFAULT_MODEL;

    this.logger.info("openai.invokeWithImage.start", {
      model_name: modelName,
      input_tokens: textTokens,
      estimated_image_tokens: estimatedImageTokens,
      text_full_length: textContent.length,
      text_snippet: textContent.slice(0, 400),
      image_data_length: imageData?.length ?? 0,
      max_tokens: options?.maxTokens,
      temperature: options?.temperature ?? 0,
    });

    const start = Date.now();
    const result = await model.invoke([
      new HumanMessage({
        content: [
          { type: "text", text: textContent },
          { type: "image_url", image_url: { url: processedImageData } },
        ],
      }),
    ]);

    const responseContent = result.content.toString();
    const outputTokens = this.tokenCounter.countTokens(responseContent);

    this.logger.info("openai.invokeWithImage.complete", {
      model_name: modelName,
      input_tokens: textTokens + estimatedImageTokens,
      output_tokens: outputTokens,
      duration_ms: Date.now() - start,
      output_full_length: responseContent.length,
      output_snippet: responseContent.slice(0, 400),
    });

    return {
      content: responseContent,
      tokenUsage: {
        input: textTokens + estimatedImageTokens,
        output: outputTokens,
      },
    };
  }

  /** Helper for base-64 / data-URL sanity checks */
  private normalizeImageData(imageData: string): string {
    if (!imageData) throw new Error("Image data is empty or null");

    if (imageData.startsWith("data:")) return imageData;

    let mimeType = "image/jpeg";
    if (imageData.startsWith("iVBORw0KGgo")) mimeType = "image/png";
    else if (imageData.startsWith("R0lGOD")) mimeType = "image/gif";
    else if (imageData.startsWith("UklGR")) mimeType = "image/webp";

    return `data:${mimeType};base64,${imageData}`;
  }
}
