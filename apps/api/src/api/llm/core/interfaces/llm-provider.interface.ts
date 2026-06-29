import { HumanMessage } from "@langchain/core/messages";
import type { ZodTypeAny } from "zod";

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

export interface LlmStructuredResponse<T> {
  parsed: T;
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

  /**
   * Send a request and have the provider return a value already validated
   * against `schema`, using the provider's native structured-output /
   * constrained-decoding support. The model fills schema fields and the SDK
   * serializes the JSON, so the output cannot be syntactically invalid JSON
   * (no unescaped quotes / control characters from free-form generation).
   *
   * Optional: providers without native structured output simply omit it, and
   * callers fall back to parsing free-form text.
   */
  invokeStructured?<T>(
    messages: HumanMessage[],
    schema: ZodTypeAny,
    options?: LlmRequestOptions,
  ): Promise<LlmStructuredResponse<T>>;

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
