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
  /**
   * Hashed end-user id forwarded to OpenAI as safety_identifier so abuse
   * attributes to one end user instead of the whole org account.
   */
  safetyIdentifier?: string;
  /**
   * Opt this request into explicit prefix caching. Ignored by providers that
   * do not advertise `supportsExplicitPromptCache`.
   */
  promptCache?: PromptCacheSpec;
}

/**
 * Describes the reusable head of a prompt so it can be cached across calls.
 *
 * GPT-5.6 caches only at explicit breakpoints, and only when the prefix is at
 * least 1024 tokens — below that the request succeeds and stores nothing, so a
 * short prefix looks identical to a working one. Older OpenAI models reject
 * the parameters outright, which is why providers gate on capability rather
 * than sending these unconditionally.
 */
export interface PromptCacheSpec {
  /**
   * Rendered invariant head. Must be a literal prefix of the formatted prompt;
   * if it is not, the caller falls back to an uncached single-block message.
   */
  prefix: string;
  /**
   * Cache routing key. Rotate it whenever `prefix` changes, so a stale entry
   * can never be served against new instructions.
   */
  key: string;
}

export interface TokenUsage {
  input: number;
  output: number;
  /**
   * Portion of `input` served from the provider's prompt cache. Set only when
   * the provider reports it, so 0 means a genuine miss on a model that does
   * report — absent means the provider gave no cache detail at all.
   */
  cachedInput?: number;
}

export interface LlmResponse {
  content: string;
  tokenUsage: TokenUsage;
}

export interface LlmStructuredResponse<T> {
  parsed: T;
  tokenUsage: TokenUsage;
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

  /**
   * True only for models that accept explicit cache breakpoints. Callers must
   * check this before building a breakpoint-bearing message: every other
   * OpenAI model rejects `prompt_cache_options` with a 400.
   */
  readonly supportsExplicitPromptCache?: boolean;
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
