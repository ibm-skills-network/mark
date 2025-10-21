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

@Injectable()
export class MistralMedium2505LlmService implements IMultimodalLlmProvider {
  private readonly logger: Logger;
  static readonly DEFAULT_MODEL = "mistralai/mistral-medium-2505";
  readonly key = "mistral-medium-2505";

  constructor(
    @Inject(TOKEN_COUNTER) private readonly tokenCounter: ITokenCounter,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({
      context: MistralMedium2505LlmService.name,
    });
  }

  private createChatModel(options?: LlmRequestOptions): ChatWatsonx {
    return new ChatWatsonx({
      version: "2024-05-31",
      serviceUrl: "https://us-south.ml.cloud.ibm.com",
      projectId: process.env.WATSONX_PROJECT_ID_LLAMA || "",
      watsonxAIAuthType: "iam",
      watsonxAIApikey: process.env.WATSONX_AI_API_KEY_LLAMA || "", // pragma: allowlist secret
      model: options?.modelName ?? MistralMedium2505LlmService.DEFAULT_MODEL,
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
      `Invoking Mistral Medium 2505 with ${inputTokens} input tokens`,
    );

    try {
      const result = await model.invoke(messages);
      const rawResponse = result.content.toString();

      const responseContent = this.extractJSONFromResponse(rawResponse);
      const outputTokens = this.tokenCounter.countTokens(responseContent);

      this.logger.debug(
        `Mistral Medium 2505 responded with ${outputTokens} output tokens`,
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
        `Mistral Medium 2505 API error: ${
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
      "Mistral Medium 2505 supports image inputs but requires special handling. Processing text only for now.",
    );

    const inputTokens = this.tokenCounter.countTokens(textContent);

    this.logger.debug(
      `Invoking Mistral Medium 2505 with text only (${inputTokens} input tokens) - image data ignored`,
    );

    const model = this.createChatModel(options);

    try {
      const result = await model.invoke([new HumanMessage(textContent)]);
      const rawResponse = result.content.toString();
      const responseContent = this.extractJSONFromResponse(rawResponse);
      const outputTokens = this.tokenCounter.countTokens(responseContent);

      this.logger.debug(
        `Mistral Medium 2505 responded with ${outputTokens} output tokens`,
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
        `Mistral Medium 2505 API error: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      throw error;
    }
  }

  private extractJSONFromResponse(response: string): string {
    try {
      JSON.parse(response);
      return response;
    } catch {
      const jsonBlockMatch = response.match(/```json\s*([\S\s]*?)\s*```/);
      if (jsonBlockMatch) {
        const jsonContent = jsonBlockMatch[1].trim();
        try {
          JSON.parse(jsonContent);
          return jsonContent;
        } catch {
          // Fall through
        }
      }

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

      this.logger.warn(
        "Could not extract valid JSON from Mistral response, returning original",
      );
      return response;
    }
  }
}
