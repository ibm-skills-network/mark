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
export class OpenAiLlmService implements IMultimodalLlmProvider {
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
      temperature: options?.temperature ?? 0,
      topP: options?.topP ?? options?.top_p ?? 1,
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
    const modelName = options?.modelName ?? OpenAiLlmService.DEFAULT_MODEL;

    this.logger.info("openai.invoke.start", {
      model_name: modelName,
      input_tokens: inputTokens,
      input_full_length: inputText.length,
      input_snippet: inputText.slice(0, 400),
      message_count: messages.length,
      max_tokens: options?.maxTokens,
      temperature: options?.temperature ?? 0,
      top_p: options?.topP ?? options?.top_p ?? 1,
    });

    const start = Date.now();
    try {
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
    } catch (error) {
      this.logger.error("OpenAiLlmService.invoke failed", {
        model_name: options?.modelName ?? OpenAiLlmService.DEFAULT_MODEL,
        input_tokens: inputTokens,
        duration_ms: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
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
    const modelName = options?.modelName ?? OpenAiLlmService.DEFAULT_MODEL;

    const estimatedImageTokens = 150;

    this.logger.info("openai.invokeWithImage.start", {
      model_name: modelName,
      input_tokens: inputTokens,
      estimated_image_tokens: estimatedImageTokens,
      text_full_length: textContent.length,
      text_snippet: textContent.slice(0, 400),
      image_data_length: imageData?.length ?? 0,
      max_tokens: options?.maxTokens,
      temperature: options?.temperature ?? 0,
    });

    const start = Date.now();
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
      this.logger.error("OpenAiLlmService.invokeWithImage failed", {
        model_name: options?.modelName ?? OpenAiLlmService.DEFAULT_MODEL,
        input_tokens: inputTokens,
        text_length: textContent?.length,
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      });
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
