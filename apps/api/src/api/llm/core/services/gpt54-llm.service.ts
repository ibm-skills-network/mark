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
import { invokeStructuredChatModel } from "./structured-output.util";
import { safetyIdentifierKwargs } from "../utils/safety-identifier.util";

abstract class PinnedGpt54LlmService implements IMultimodalLlmProvider {
  protected readonly logger: Logger;
  abstract readonly key: string;

  protected constructor(
    private readonly modelName: string,
    private readonly tokenCounter: ITokenCounter,
    parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({
      context: this.constructor.name,
      modelName,
    });
  }

  private createChatModel(options?: LlmRequestOptions): ChatOpenAI {
    return new ChatOpenAI({
      // This provider key represents an immutable grading snapshot. Do not
      // allow a per-call alias to reintroduce model drift.
      modelName: this.modelName,
      // LangChain's installed OpenAI SDK types predate GPT-5.4's `none`
      // effort, so pass the documented Chat Completions field through its
      // forward-compatible model kwargs bag.
      modelKwargs: {
        reasoning_effort: "none",
        ...safetyIdentifierKwargs(options),
      },
      maxCompletionTokens: options?.maxTokens ?? 4096,
      timeout: options?.timeoutMs,
      maxRetries: options?.maxRetries,
    });
  }

  async invoke(
    messages: HumanMessage[],
    options?: LlmRequestOptions,
  ): Promise<LlmResponse> {
    const inputText = messages
      .map((message) =>
        typeof message.content === "string"
          ? message.content
          : JSON.stringify(message.content),
      )
      .join("\n");
    const inputTokens = this.tokenCounter.countTokens(inputText);
    const result = await this.createChatModel(options).invoke(messages);
    const content = result.content.toString();

    return {
      content,
      tokenUsage: {
        input: inputTokens,
        output: this.tokenCounter.countTokens(content),
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
      this.key,
    );
  }

  async invokeWithImage(
    textContent: string,
    imageData: string,
    options?: LlmRequestOptions,
  ): Promise<LlmResponse> {
    if (!imageData) throw new Error("Image data is empty or null");
    const imageUrl = imageData.startsWith("data:")
      ? imageData
      : `data:image/jpeg;base64,${imageData}`;

    return this.invoke(
      [
        new HumanMessage({
          content: [
            { type: "text", text: textContent },
            {
              type: "image_url",
              image_url: {
                url: imageUrl,
                detail: options?.imageDetail ?? "auto",
              },
            },
          ],
        }),
      ],
      options,
    );
  }
}

@Injectable()
export class Gpt54MiniLlmService extends PinnedGpt54LlmService {
  static readonly MODEL = "gpt-5.4-mini-2026-03-17";
  readonly key = Gpt54MiniLlmService.MODEL;

  constructor(
    @Inject(TOKEN_COUNTER) tokenCounter: ITokenCounter,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    super(Gpt54MiniLlmService.MODEL, tokenCounter, parentLogger);
  }
}

@Injectable()
export class Gpt54NanoLlmService extends PinnedGpt54LlmService {
  static readonly MODEL = "gpt-5.4-nano-2026-03-17";
  readonly key = Gpt54NanoLlmService.MODEL;

  constructor(
    @Inject(TOKEN_COUNTER) tokenCounter: ITokenCounter,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    super(Gpt54NanoLlmService.MODEL, tokenCounter, parentLogger);
  }
}
