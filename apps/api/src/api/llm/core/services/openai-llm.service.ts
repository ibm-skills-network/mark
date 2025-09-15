import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { Inject, Injectable } from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { TOKEN_COUNTER } from "../../llm.constants";
import {
  ILlmProvider,
  LlmRequestOptions,
  LlmResponse,
} from "../interfaces/llm-provider.interface";
import { ITokenCounter } from "../interfaces/token-counter.interface";

@Injectable()
export class OpenAiLlmService implements ILlmProvider {
  private readonly logger: Logger;
  static readonly DEFAULT_MODEL = "gpt-4o";
  readonly key = "gpt-4o";

  constructor(
    @Inject(TOKEN_COUNTER) private readonly tokenCounter: ITokenCounter,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: OpenAiLlmService.name });
  }

  /**
   * Create a ChatOpenAI instance with the given options
   */
  private createChatModel(options?: LlmRequestOptions): ChatOpenAI {
    return new ChatOpenAI({
      temperature: options?.temperature ?? 0.5,
      modelName: options?.modelName ?? OpenAiLlmService.DEFAULT_MODEL,
      maxTokens: options?.maxTokens,
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

    this.logger.debug(`Invoking LLM with ${inputTokens} input tokens`);

    const result = await model.invoke(messages);
    const responseContent = result.content.toString();
    const outputTokens = this.tokenCounter.countTokens(responseContent);

    this.logger.debug(`LLM responded with ${outputTokens} output tokens`);

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

    const estimatedImageTokens = 150;

    this.logger.debug(
      `Invoking LLM with image (${inputTokens} text tokens + ~${estimatedImageTokens} image tokens)`,
    );

    try {
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

      this.logger.debug(
        `LLM with image responded with ${outputTokens} output tokens`,
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
        `Error processing image with LLM: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      throw error;
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
    }

    return `data:${mimeType};base64,${imageData}`;
  }
}
