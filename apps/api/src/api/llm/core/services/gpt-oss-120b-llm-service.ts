import { WatsonxLLM } from "@langchain/community/llms/ibm";
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

@Injectable()
export class GptOss120bLlmService implements IMultimodalLlmProvider {
  private readonly logger: Logger;
  static readonly DEFAULT_MODEL = "openai/gpt-oss-120b";
  readonly key = "gpt-oss-120b";

  constructor(
    @Inject(TOKEN_COUNTER) private readonly tokenCounter: ITokenCounter,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: GptOss120bLlmService.name });
  }

  private createChatModel(options?: LlmRequestOptions): WatsonxLLM {
    return new WatsonxLLM({
      version: "2024-05-31",
      serviceUrl: "https://us-south.ml.cloud.ibm.com",
      projectId: process.env.WATSONX_PROJECT_ID_LLAMA || "",
      watsonxAIAuthType: "iam",
      watsonxAIApikey: process.env.WATSONX_AI_API_KEY_LLAMA || "", // pragma: allowlist secret
      model: options?.modelName ?? GptOss120bLlmService.DEFAULT_MODEL,
      temperature: options?.temperature ?? 0.5,
      maxNewTokens: options?.maxTokens ?? 1000,
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

    this.logger.debug(`Invoking WatsonX LLM with ${inputTokens} input tokens`);

    try {
      console.log(`Invoking WatsonX LLM with input: ${inputText}`);
      const result = await model.invoke(inputText);
      console.log(`WatsonX LLM response: ${result}`);
      const rawResponse = typeof result === "string" ? result : String(result);

      // Extract JSON from the response if it contains additional text
      const responseContent = this.extractJSONFromResponse(rawResponse);
      const outputTokens = this.tokenCounter.countTokens(responseContent);

      this.logger.debug(
        `WatsonX LLM responded with ${outputTokens} output tokens`,
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
        `WatsonX LLM API error: ${
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
    this.logger.warn(
      "WatsonX LLM does not support multimodal (text + image) inputs. Processing text only.",
    );

    const inputTokens = this.tokenCounter.countTokens(textContent);

    this.logger.debug(
      `Invoking WatsonX LLM with text only (${inputTokens} input tokens) - image data ignored`,
    );

    const model = this.createChatModel(options);

    try {
      const result = await model.invoke(textContent);
      const rawResponse = typeof result === "string" ? result : String(result);
      const responseContent = this.extractJSONFromResponse(rawResponse);
      const outputTokens = this.tokenCounter.countTokens(responseContent);

      this.logger.debug(
        `WatsonX LLM responded with ${outputTokens} output tokens`,
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
        `WatsonX LLM API error: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      throw error;
    }
  }

  /**
   * Extract JSON from WatsonX response that may contain additional text
   */
  private extractJSONFromResponse(response: string): string {
    try {
      // First, try to parse the response as-is in case it's already clean JSON
      JSON.parse(response);
      return response;
    } catch {
      // If that fails, try to extract JSON from markdown code blocks
      const jsonBlockMatch = response.match(/```json\s*([\S\s]*?)\s*```/);
      if (jsonBlockMatch) {
        const jsonContent = jsonBlockMatch[1].trim();
        try {
          JSON.parse(jsonContent);
          return jsonContent;
        } catch {
          // Fall through to other extraction methods
        }
      }

      // Try to find JSON object patterns in the response
      const jsonObjectMatch = response.match(/{[\S\s]*}/);
      if (jsonObjectMatch) {
        const jsonContent = jsonObjectMatch[0];
        try {
          JSON.parse(jsonContent);
          return jsonContent;
        } catch {
          // Fall through
        }
      }

      // If no valid JSON found, return the original response
      this.logger.warn(
        "Could not extract valid JSON from WatsonX response, returning original",
      );
      return response;
    }
  }

  /**
   * Normalize image data to ensure it has the correct format
   * Note: WatsonX LLM does not support image inputs, but keeping this method for potential future use
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
