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
   * Per-request HTTP timeout in milliseconds. Without it a stalled
   * connection waits on the SDK default (10 minutes for OpenAI), far past
   * any caller-side deadline.
   */
  timeoutMs?: number;
  /**
   * Provider-SDK-level retry count. Callers that run their own retry loop
   * should set this low so attempts do not multiply.
   */
  maxRetries?: number;
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
