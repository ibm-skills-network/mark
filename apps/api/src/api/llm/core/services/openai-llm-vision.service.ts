import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { Inject, Injectable } from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { TOKEN_COUNTER } from "../../llm.constants";
import {
  IMultimodalLlmProvider,
  LlmRequestOptions,
  LlmResponse,
} from "../interfaces/llm-provider.interface";
import { ITokenCounter } from "../interfaces/token-counter.interface";

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
      temperature: options?.temperature ?? 0.5,
      modelName:
        options?.modelName ?? Gpt4VisionPreviewLlmService.DEFAULT_MODEL,
      maxTokens: options?.maxTokens ?? 4096, // Vision preview has token limits
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

    this.logger.debug(
      `Invoking GPT-4 Vision Preview with ${inputTokens} input tokens`,
    );

    const result = await model.invoke(messages);
    const responseContent = result.content.toString();
    const outputTokens = this.tokenCounter.countTokens(responseContent);

    this.logger.debug(
      `GPT-4 Vision Preview responded with ${outputTokens} output tokens`,
    );

    return {
      content: responseContent,
      tokenUsage: {
        input: inputTokens,
        output: outputTokens,
      },
    };
  }

  /**
   * Send a request with image content to the LLM
   */
  async invokeWithImage(
    textContent: string,
    imageData: string,
    options?: LlmRequestOptions,
  ): Promise<LlmResponse> {
    const model = this.createChatModel(options);

    const processedImageData = this.normalizeImageData(imageData);
    const inputTokens = this.tokenCounter.countTokens(textContent);

    // GPT-4 Vision Preview uses a different token calculation for images
    // Images are processed in 512px chunks, each chunk costs ~170 tokens
    const estimatedImageTokens = this.estimateImageTokens(processedImageData);

    this.logger.debug(
      `Invoking GPT-4 Vision Preview with image (${inputTokens} text tokens + ~${estimatedImageTokens} image tokens)`,
    );

    try {
      const result = await model.invoke([
        new HumanMessage({
          content: [
            { type: "text", text: textContent },
            {
              type: "image_url",
              image_url: {
                url: processedImageData,
                detail: options?.imageDetail ?? "auto", // auto, low, high
              },
            },
          ],
        }),
      ]);

      const responseContent = result.content.toString();
      const outputTokens = this.tokenCounter.countTokens(responseContent);

      this.logger.debug(
        `GPT-4 Vision Preview responded with ${outputTokens} output tokens`,
      );

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
      // Extract base64 data if it's a data URL
      const base64Data = imageData.includes(",")
        ? imageData.split(",")[1]
        : imageData;

      // Estimate image size in bytes (base64 is ~1.33x larger than binary)
      const estimatedBytes = (base64Data.length * 3) / 4;

      // Rough estimation: GPT-4 Vision processes images in chunks
      // Low detail: ~85 tokens per image
      // High detail: depends on image size, roughly 170 tokens per 512px tile

      if (estimatedBytes < 50_000) {
        // Small image (~50KB)
        return 85; // Low detail processing
      } else if (estimatedBytes < 200_000) {
        // Medium image (~200KB)
        return 255; // ~1.5 tiles
      } else if (estimatedBytes < 500_000) {
        // Large image (~500KB)
        return 510; // ~3 tiles
      } else {
        return 765; // Very large image, ~4.5 tiles
      }
    } catch (error) {
      this.logger.warn("Could not estimate image tokens, using default", error);
      return 170; // Default estimate
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

    // Detect image format based on base64 header
    let mimeType = "image/jpeg"; // Default

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
