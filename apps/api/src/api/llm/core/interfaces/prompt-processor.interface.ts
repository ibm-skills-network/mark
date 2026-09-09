import { PromptTemplate } from "@langchain/core/prompts";
import { AIUsageType } from "@prisma/client";
import type { ZodTypeAny } from "zod";
import { LlmRequestOptions } from "./llm-provider.interface";

export interface IPromptProcessor {
  /**
   * Process a prompt using assigned model for a specific feature
   */
  processPromptForFeature(
    prompt: PromptTemplate,
    assignmentId: number,
    usageType: AIUsageType,
    featureKey: string,
    fallbackModel?: string,
    options?: LlmRequestOptions,
  ): Promise<string>;

  /**
   * Process a prompt for a feature and return a value validated against
   * `schema`. Uses the assigned provider's native structured output when
   * available (guaranteeing schema-valid JSON), and falls back to parsing the
   * model's text for providers that do not support it.
   */
  processStructuredPromptForFeature<T>(
    prompt: PromptTemplate,
    assignmentId: number,
    usageType: AIUsageType,
    featureKey: string,
    schema: ZodTypeAny,
    fallbackModel?: string,
    options?: LlmRequestOptions,
  ): Promise<T>;

  /**
   * Process a structured prompt with an explicitly selected provider. Unlike
   * the feature-routed variant, this does not allow a feature assignment to
   * silently replace the requested model.
   */
  processStructuredPrompt<T>(
    prompt: PromptTemplate,
    assignmentId: number,
    usageType: AIUsageType,
    schema: ZodTypeAny,
    llmKey: string,
    options?: LlmRequestOptions,
  ): Promise<T>;

  /**
   * Process a text prompt and return the LLM response
   */
  processPrompt(
    prompt: string | PromptTemplate,
    assignmentId: number,
    usageType: AIUsageType,
    llmKey?: string,
    options?: LlmRequestOptions,
  ): Promise<string>;

  /**
   * Process a prompt with image data and return the LLM response.
   *
   * `imageData` accepts one payload or a list. Multi-image submissions must
   * send every resolved image, not just a "primary" one; the caller is
   * responsible for bounding how many images and how many bytes it passes.
   */
  processPromptWithImage(
    prompt: PromptTemplate,
    imageData: string | string[],
    assignmentId: number,
    usageType: AIUsageType,
    llmKey?: string,
    options?: LlmRequestOptions,
  ): Promise<string>;
}
