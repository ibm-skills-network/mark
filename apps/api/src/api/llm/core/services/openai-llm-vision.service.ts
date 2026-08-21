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
import {
  toImageDataList,
  totalImageDataLength,
} from "../utils/multimodal-image.util";
import { invokeStructuredChatModel } from "./structured-output.util";
import { safetyIdentifierKwargs } from "../utils/safety-identifier.util";

@Injectable()
export class Gpt4VisionPreviewLlmService implements IMultimodalLlmProvider {
  private readonly logger: Logger;
  static readonly DEFAULT_MODEL = "gpt-4.1-mini";
  readonly key = "gpt-4.1-mini";

  constructor(
    @Inject(TOKEN_COUNTER) private readonly tokenCounter: ITokenCounter,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({
      context: Gpt4VisionPreviewLlmService.name,
    });
  }

  /**
   * Create a ChatOpenAI instance with the given options
   */
  private createChatModel(options?: LlmRequestOptions): ChatOpenAI {
    return new ChatOpenAI({
      temperature: options?.temperature ?? 0,
      modelName:
        options?.modelName ?? Gpt4VisionPreviewLlmService.DEFAULT_MODEL,
      maxTokens: options?.maxTokens ?? 4096,
      timeout: options?.timeoutMs,
      maxRetries: options?.maxRetries,
      modelKwargs: safetyIdentifierKwargs(options),
    });
  }

  /**
   * Send a request to the LLM and get a response
   */
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
    const modelName =
      options?.modelName ?? Gpt4VisionPreviewLlmService.DEFAULT_MODEL;

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
      tokenUsage: {
        input: inputTokens,
        output: outputTokens,
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
      options?.modelName ?? this.key,
    );
  }

  /**
   * Send a request with image content to the LLM
   */
  async invokeWithImage(
    textContent: string,
    imageData: string | string[],
    options?: LlmRequestOptions,
  ): Promise<LlmResponse> {
    const model = this.createChatModel(options);

    const processedImages = toImageDataList(imageData).map((entry) =>
      this.normalizeImageData(entry),
    );
    const inputTokens = this.tokenCounter.countTokens(textContent);
    const modelName =
      options?.modelName ?? Gpt4VisionPreviewLlmService.DEFAULT_MODEL;

    const estimatedImageTokens = processedImages.reduce(
      (sum, url) => sum + this.estimateImageTokens(url),
      0,
    );

    this.logger.info("openai.invokeWithImage.start", {
      model_name: modelName,
      input_tokens: inputTokens,
      estimated_image_tokens: estimatedImageTokens,
      text_full_length: textContent.length,
      text_snippet: textContent.slice(0, 400),
      image_count: processedImages.length,
      image_data_length: totalImageDataLength(imageData),
      image_detail: options?.imageDetail ?? "auto",
      max_tokens: options?.maxTokens,
      temperature: options?.temperature ?? 0,
    });

    const start = Date.now();
    try {
      const result = await model.invoke([
        new HumanMessage({
          content: [
            { type: "text", text: textContent },
            ...processedImages.map((url) => ({
              type: "image_url" as const,
              image_url: {
                url,
                detail: options?.imageDetail ?? "auto",
              },
            })),
          ],
        }),
      ]);

      const responseContent = result.content.toString();
      const outputTokens = this.tokenCounter.countTokens(responseContent);

      this.logger.info("openai.invokeWithImage.complete", {
        model_name: modelName,
        input_tokens: inputTokens + estimatedImageTokens,
        output_tokens: outputTokens,
        duration_ms: Date.now() - start,
        output_full_length: responseContent.length,
        output_snippet: responseContent.slice(0, 400),
      });

      return {
        content: responseContent,
        tokenUsage: {
          input: inputTokens + estimatedImageTokens,
          output: outputTokens,
        },
      };
    } catch (error) {
      this.logger.error(
        `Error processing image with GPT-4 Vision Preview: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      throw error;
    }
  }

  /**
   * Estimate image token usage for GPT-4 Vision Preview
   * Based on OpenAI's documentation for vision pricing
   */
  private estimateImageTokens(imageData: string): number {
    try {
      const base64Data = imageData.includes(",")
        ? imageData.split(",")[1]
        : imageData;

      const estimatedBytes = (base64Data.length * 3) / 4;

      if (estimatedBytes < 50_000) {
        return 85;
      } else if (estimatedBytes < 200_000) {
        return 255;
      } else if (estimatedBytes < 500_000) {
        return 510;
      } else {
        return 765;
      }
    } catch (error) {
      this.logger.warn("Could not estimate image tokens, using default", error);
      return 170;
    }
  }

  /**
   * Normalize image data to ensure it has the correct format
   */
  private normalizeImageData(imageData: string): string {
    if (!imageData) {
      throw new Error("Image data is empty or null");
    }

    if (imageData.startsWith("data:")) {
      return imageData;
    }

    let mimeType = "image/jpeg";

    if (imageData.startsWith("/9j/")) {
      mimeType = "image/jpeg";
    } else if (imageData.startsWith("iVBORw0KGgo")) {
      mimeType = "image/png";
    } else if (imageData.startsWith("R0lGOD")) {
      mimeType = "image/gif";
    } else if (imageData.startsWith("UklGR")) {
      mimeType = "image/webp";
    } else if (imageData.startsWith("Qk")) {
      mimeType = "image/bmp";
    }

    return `data:${mimeType};base64,${imageData}`;
  }
}
