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
export class Llama4MaverickLlmService implements IMultimodalLlmProvider {
  private readonly logger: Logger;
  static readonly DEFAULT_MODEL =
    "meta-llama/llama-4-maverick-17b-128e-instruct-fp8";
  readonly key = "llama-4-maverick";

  constructor(
    @Inject(TOKEN_COUNTER) private readonly tokenCounter: ITokenCounter,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({
      context: Llama4MaverickLlmService.name,
    });
  }

  private createChatModel(options?: LlmRequestOptions): ChatWatsonx {
    return new ChatWatsonx({
      version: "2024-05-31",
      serviceUrl: "https://us-south.ml.cloud.ibm.com",
      projectId: process.env.WATSONX_PROJECT_ID_LLAMA || "",
      watsonxAIAuthType: "iam",
      watsonxAIApikey: process.env.WATSONX_AI_API_KEY_LLAMA || "",
      model: options?.modelName ?? Llama4MaverickLlmService.DEFAULT_MODEL,
      temperature: options?.temperature ?? 0.5,
      maxTokens: options?.maxTokens ?? 2000,
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
      `Invoking Llama 4 Maverick with ${inputTokens} input tokens`,
    );

    try {
      const result = await withWatsonxRateLimit(() => model.invoke(messages));
      const rawResponse = result.content.toString();

      const responseContent = this.extractJSONFromResponse(rawResponse);
      const outputTokens = this.tokenCounter.countTokens(responseContent);

      this.logger.debug(
        `Llama 4 Maverick responded with ${outputTokens} output tokens`,
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
        `Llama 4 Maverick API error: ${
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
    this.logger.info(
      "Llama 4 Maverick supports multimodal inputs. Processing text and image.",
    );

    const inputTokens = this.tokenCounter.countTokens(textContent);

    this.logger.debug(
      `Invoking Llama 4 Maverick with multimodal input (${inputTokens} text input tokens)`,
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
        `Llama 4 Maverick responded with ${outputTokens} output tokens`,
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
        `Llama 4 Maverick API error: ${
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
      "Could not extract valid JSON from Llama 4 Maverick response, returning original",
    );
    return response;
  }
}
