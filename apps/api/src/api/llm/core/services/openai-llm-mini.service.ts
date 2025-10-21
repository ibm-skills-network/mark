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
      temperature: options?.temperature ?? 0.5,
      modelName: options?.modelName ?? OpenAiLlmMiniService.DEFAULT_MODEL,
      maxTokens: options?.maxTokens,
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
    this.logger.debug(`Invoking 4o-mini with ${inputTokens} input tokens`);

    const result = await model.invoke(messages);
    const responseContent = result.content.toString();
    const outputTokens = this.tokenCounter.countTokens(responseContent);

    this.logger.debug(`4o-mini responded with ${outputTokens} output tokens`);

    return {
      content: responseContent,
      tokenUsage: { input: inputTokens, output: outputTokens },
    };
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
    this.logger.debug(
      `Invoking 4o-mini with image (${textTokens} text tokens + ~${estimatedImageTokens} image tokens)`,
    );

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
      `4o-mini with image responded with ${outputTokens} output tokens`,
    );

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
