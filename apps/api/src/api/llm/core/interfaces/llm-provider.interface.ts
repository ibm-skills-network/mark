import { HumanMessage } from "@langchain/core/messages";

export interface LlmRequestOptions {
  temperature?: number;
  topP?: number;
  /**
   * Deprecated: prefer topP. Kept for backward compatibility.
   */
  top_p?: number;
  maxTokens?: number;
  modelName?: string;
  imageDetail?: "auto" | "low" | "high";
  /**
   * OpenAI sampling seed. With temperature=0 + topP=1 + a fixed seed, repeat
   * requests with identical input return identical output (best-effort; OpenAI
   * does not formally guarantee determinism, but seeded calls collide far more
   * often than unseeded ones).
   */
  seed?: number;
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
