import { HumanMessage } from "@langchain/core/messages";

export interface LlmRequestOptions {
  temperature?: number;
  maxTokens?: number;
  modelName?: string;
  imageDetail?: "auto" | "low" | "high";
}

export interface LlmResponse {
  content: string;
  tokenUsage: {
    input: number;
    output: number;
  };
}

export interface ILlmProvider {
  /**
   * Send a request to the LLM and get a response
   */
  invoke(
    messages: HumanMessage[],
    options?: LlmRequestOptions,
  ): Promise<LlmResponse>;
  readonly key: string;
}

export interface IMultimodalLlmProvider extends ILlmProvider {
  /**
   * Send a request with image content to the LLM
   */
  invokeWithImage(
    textContent: string,
    imageData: string,
    options?: LlmRequestOptions,
  ): Promise<LlmResponse>;
}
