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

  private createChatModel(options?: LlmRequestOptions): ChatWatsonx {
    return new ChatWatsonx({
      version: "2024-05-31",
      serviceUrl: "https://us-south.ml.cloud.ibm.com",
      projectId: process.env.WATSONX_PROJECT_ID_LLAMA || "",
      watsonxAIAuthType: "iam",
      watsonxAIApikey: process.env.WATSONX_AI_API_KEY_LLAMA || "", // pragma: allowlist secret
      model: options?.modelName ?? GptOss120bLlmService.DEFAULT_MODEL,
      temperature: options?.temperature ?? 0.5,
      maxTokens: options?.maxTokens ?? 8000,
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

    this.logger.debug(`Invoking WatsonX Chat with ${inputTokens} input tokens`);

    try {
      console.log(`Invoking WatsonX Chat with ${messages.length} messages`);
      const result = await withWatsonxRateLimit(() => model.invoke(messages));
      console.log(`WatsonX Chat response received`);
      const rawResponse = result.content.toString();

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
      "WatsonX Chat does not support multimodal (text + image) inputs. Processing text only.",
    );

    const inputTokens = this.tokenCounter.countTokens(textContent);

    this.logger.debug(
      `Invoking WatsonX Chat with text only (${inputTokens} input tokens) - image data ignored`,
    );

    const model = this.createChatModel(options);

    try {
      const result = await withWatsonxRateLimit(() =>
        model.invoke([new HumanMessage(textContent)]),
      );
      const rawResponse = result.content.toString();
      const responseContent = this.extractJSONFromResponse(rawResponse);
      const outputTokens = this.tokenCounter.countTokens(responseContent);

      this.logger.debug(
        `WatsonX Chat responded with ${outputTokens} output tokens`,
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
        `WatsonX Chat API error: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      throw error;
    }
  }

  /**
   * Extract JSON from WatsonX response that may contain additional text or be truncated
   */
  private extractJSONFromResponse(response: string): string {
    // 1) If the whole response is valid JSON, return it
    try {
      JSON.parse(response);
      return response;
    } catch {
      // continue
    }

    // Use shared extractor which handles schema echoes and noisy wrappers
    return extractStructuredJSON(response);
  }

  /**
   * Attempt to repair truncated JSON by closing open strings, arrays, and objects
   */
  private repairTruncatedJSON(json: string): string | null {
    try {
      // Try to parse first to see if it's valid
      JSON.parse(json);
      return json;
    } catch (error) {
      // If it's not valid JSON, try to repair it
      let repaired = json.trim();

      // Check if we're in the middle of a string (unterminated string error)
      if (
        error instanceof SyntaxError &&
        error.message.includes("Unterminated string")
      ) {
        // Find the last complete quote and truncate there, then close the string
        const lastCompleteQuote = repaired.lastIndexOf(
          '"',
          repaired.length - 2,
        );
        if (lastCompleteQuote > 0) {
          // Check if this quote is escaped
          let quotePos = lastCompleteQuote;
          let escapeCount = 0;
          while (quotePos > 0 && repaired[quotePos - 1] === "\\") {
            escapeCount++;
            quotePos--;
          }

          // If odd number of escapes, the quote is escaped, find the previous one
          if (escapeCount % 2 === 1) {
            const previousQuote = repaired.lastIndexOf(
              '"',
              lastCompleteQuote - 1,
            );
            if (previousQuote > 0) {
              repaired = repaired.slice(0, Math.max(0, previousQuote + 1));
            }
          } else {
            repaired = repaired.slice(0, Math.max(0, lastCompleteQuote + 1));
          }
        }

        // Add closing quote if we ended on an open quote
        const quoteCount = (repaired.match(/"/g) || []).length;
        if (quoteCount % 2 === 1) {
          repaired += '"';
        }
      }

      // Count open braces and brackets
      const openBraces = (repaired.match(/{/g) || []).length;
      const closeBraces = (repaired.match(/}/g) || []).length;
      const openBrackets = (repaired.match(/\[/g) || []).length;
      const closeBrackets = (repaired.match(/]/g) || []).length;

      // Remove any trailing commas before we close things
      repaired = repaired.replace(/,\s*$/, "");

      // Close arrays first (inner to outer)
      for (let index = 0; index < openBrackets - closeBrackets; index++) {
        repaired += "]";
      }

      // Close objects (outer to inner)
      for (let index = 0; index < openBraces - closeBraces; index++) {
        repaired += "}";
      }

      // Try to parse the repaired JSON
      try {
        JSON.parse(repaired);
        this.logger.info(
          `Successfully repaired truncated JSON (added ${
            openBraces - closeBraces
          } closing braces, ${openBrackets - closeBrackets} closing brackets)`,
        );
        return repaired;
      } catch (repairError) {
        this.logger.warn(
          `Failed to repair truncated JSON: ${
            repairError instanceof Error ? repairError.message : "Unknown error"
          }`,
        );
        return null;
      }
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
