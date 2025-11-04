import { ChatWatsonx } from "@langchain/community/chat_models/ibm";
import { HumanMessage } from "@langchain/core/messages";
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
import { extractStructuredJSON } from "../utils/structured-json.util";
import { withWatsonxRateLimit } from "../utils/watsonx-rate-limiter";

@Injectable()
export class GraniteVision322bLlmService implements IMultimodalLlmProvider {
  private readonly logger: Logger;
  static readonly DEFAULT_MODEL = "ibm/granite-vision-3-2-2b";
  readonly key = "granite-vision-3-2-2b";

  constructor(
    @Inject(TOKEN_COUNTER) private readonly tokenCounter: ITokenCounter,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({
      context: GraniteVision322bLlmService.name,
    });
  }

  private createChatModel(options?: LlmRequestOptions): ChatWatsonx {
    return new ChatWatsonx({
      version: "2024-05-31",
      serviceUrl: "https://us-south.ml.cloud.ibm.com",
      projectId: process.env.WATSONX_PROJECT_ID_LLAMA || "",
      watsonxAIAuthType: "iam",
      watsonxAIApikey: process.env.WATSONX_AI_API_KEY_LLAMA || "",
      model: options?.modelName ?? GraniteVision322bLlmService.DEFAULT_MODEL,
      temperature: options?.temperature ?? 0.5,
      maxTokens: options?.maxTokens ?? 4096,
    });
  }

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
      `Invoking Granite Vision 3.2 2B with ${inputTokens} input tokens`,
    );

    try {
      const result = await withWatsonxRateLimit(() => model.invoke(messages));
      const rawResponse = result.content.toString();

      const responseContent = this.extractJSONFromResponse(rawResponse);
      const outputTokens = this.tokenCounter.countTokens(responseContent);

      this.logger.debug(
        `Granite Vision 3.2 2B responded with ${outputTokens} output tokens`,
      );

      return {
        content: responseContent,
        tokenUsage: {
          input: inputTokens,
          output: outputTokens,
        },
      };
    } catch (error) {
      this.logger.error(
        `Granite Vision 3.2 2B API error: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      throw error;
    }
  }

  async invokeWithImage(
    textContent: string,
    imageData: string,
    options?: LlmRequestOptions,
  ): Promise<LlmResponse> {
    const model = this.createChatModel(options);

    const processedImageData = this.normalizeImageData(imageData);
    const inputTokens = this.tokenCounter.countTokens(textContent);
    const estimatedImageTokens = this.estimateImageTokens(processedImageData);

    this.logger.debug(
      `Invoking Granite Vision 3.2 2B with multimodal input (${inputTokens} text tokens + ~${estimatedImageTokens} image tokens)`,
    );

    try {
      const result = await withWatsonxRateLimit(() =>
        model.invoke([
          new HumanMessage({
            content: [
              { type: "text", text: textContent },
              {
                type: "image_url",
                image_url: {
                  url: processedImageData,
                },
              },
            ],
          }),
        ]),
      );

      const rawResponse = result.content.toString();
      const responseContent = this.extractJSONFromResponse(rawResponse);
      const outputTokens = this.tokenCounter.countTokens(responseContent);

      this.logger.debug(
        `Granite Vision 3.2 2B responded with ${outputTokens} output tokens`,
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
        `Granite Vision 3.2 2B API error: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      throw error;
    }
  }

  private extractJSONFromResponse(response: string): string {
    const extracted = extractStructuredJSON(response);
    if (extracted !== response) return extracted;

    this.logger.warn(
      "Could not extract valid JSON from Granite Vision response, returning original",
    );
    return response;
  }

  /**
   * Estimate image token usage for Granite Vision
   * Based on similar multimodal models' pricing
   */
  private estimateImageTokens(imageData: string): number {
    try {
      const base64Data = imageData.includes(",")
        ? imageData.split(",")[1]
        : imageData;

      const estimatedBytes = (base64Data.length * 3) / 4;

      if (estimatedBytes < 50_000) {
        return 100;
      } else if (estimatedBytes < 200_000) {
        return 300;
      } else if (estimatedBytes < 500_000) {
        return 600;
      } else {
        return 900;
      }
    } catch (error) {
      this.logger.warn("Could not estimate image tokens, using default", error);
      return 300;
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
