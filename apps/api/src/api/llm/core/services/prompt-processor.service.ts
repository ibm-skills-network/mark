/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { StructuredOutputParser } from "@langchain/classic/output_parsers";
import { HumanMessage } from "@langchain/core/messages";
import { PromptTemplate } from "@langchain/core/prompts";
import { Inject, Injectable } from "@nestjs/common";
import { AIUsageType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import type { ZodTypeAny } from "zod";
import { decodeFields, decodeIfBase64 } from "../../../../helpers/decoder";
import { AiFeatureFlagsService } from "../../../ai-feature-flags/ai-feature-flags.service";
import { USAGE_TRACKER } from "../../llm.constants";
import {
  ILlmProvider,
  LlmRequestOptions,
} from "../interfaces/llm-provider.interface";
import { IPromptProcessor } from "../interfaces/prompt-processor.interface";
import { IUsageTracker } from "../interfaces/user-tracking.interface";
import { logAiInvocation } from "../utils/ai-invocation-log.util";
import {
  buildPromptMessage,
  promptCacheApplies,
} from "../utils/prompt-cache.util";
import { LlmRouter } from "./llm-router.service";

@Injectable()
export class PromptProcessorService implements IPromptProcessor {
  private readonly logger: Logger;

  constructor(
    private readonly router: LlmRouter,
    @Inject(USAGE_TRACKER) private readonly usageTracker: IUsageTracker,
    private readonly aiFlags: AiFeatureFlagsService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: PromptProcessorService.name });
  }

  /**
   * Process a prompt using assigned model for a specific feature
   */
  async processPromptForFeature(
    prompt: PromptTemplate,
    assignmentId: number,
    usageType: AIUsageType,
    featureKey: string,
    fallbackModel = "gpt-4o-mini",
    options?: LlmRequestOptions,
  ): Promise<string> {
    // Kill-switch backstop: never make a paid provider call for a disabled
    // AI component, even for work that was already queued before the flip.
    this.aiFlags.assertUsageEnabled(usageType);
    try {
      const llm = await this.router.getForFeatureWithFallback(
        featureKey,
        fallbackModel,
      );

      return await this._processPromptWithProvider(
        prompt,
        assignmentId,
        usageType,
        llm,
        options,
        featureKey,
      );
    } catch (error) {
      this.logger.error(
        `Error processing prompt for feature ${featureKey}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      throw error;
    }
  }

  /**
   * Wraps the formatted prompt in a message, splitting off a cacheable head
   * when the caller asked for it and the model supports it.
   *
   * Every fallback returns the plain single-block message this method has
   * always produced, so a caching miss can only ever cost money — never change
   * what the model is asked.
   */
  private buildMessageFor(
    llm: ILlmProvider,
    input: string,
    options?: LlmRequestOptions,
  ): HumanMessage {
    const requested = options?.promptCache;
    if (!requested || !llm.supportsExplicitPromptCache) {
      return new HumanMessage(input);
    }

    if (!promptCacheApplies(input, requested)) {
      // The head drifted from the template it was derived from. Caching the
      // wrong bytes is worse than not caching, so drop to the plain form and
      // make the drift visible rather than silently paying full price.
      this.logger.warn(
        "Prompt cache prefix does not match the formatted prompt",
        {
          model_key: llm.key,
          cache_key: requested.key,
          prefix_length: requested.prefix.length,
          prompt_length: input.length,
        },
      );
      return new HumanMessage(input);
    }

    return buildPromptMessage(input, requested);
  }

  /**
   * Process a prompt for a feature and return a value validated against
   * `schema`, preferring the provider's native structured output.
   */
  async processStructuredPromptForFeature<T>(
    prompt: PromptTemplate,
    assignmentId: number,
    usageType: AIUsageType,
    featureKey: string,
    schema: ZodTypeAny,
    fallbackModel = "gpt-4o-mini",
    options?: LlmRequestOptions,
  ): Promise<T> {
    // Kill-switch backstop (see processPromptForFeature).
    this.aiFlags.assertUsageEnabled(usageType);
    const llm = await this.router.getForFeatureWithFallback(
      featureKey,
      fallbackModel,
    );

    // Preferred path: provider-native structured output (constrained decoding).
    // The model fills schema fields and the SDK serializes the JSON, so the
    // output can never be syntactically invalid JSON — eliminating the
    // unescaped-quote / control-character parse failures that free-form JSON
    // generation produces on code-heavy submissions.
    if (typeof llm.invokeStructured === "function") {
      const input = await this.formatPromptInput(prompt);
      const { parsed, tokenUsage } = await llm.invokeStructured<T>(
        [this.buildMessageFor(llm, input, options)],
        schema,
        options,
      );
      logAiInvocation(this.logger, {
        modelKey: llm.key,
        purpose: featureKey,
        prompt: input,
        response: JSON.stringify(parsed),
        context: {
          assignment_id: assignmentId,
          usage_type: usageType,
          input_tokens: tokenUsage.input,
          output_tokens: tokenUsage.output,
          cached_input_tokens: tokenUsage.cachedInput,
        },
      });
      await this.trackUsageSafely(
        assignmentId,
        usageType,
        tokenUsage.input,
        tokenUsage.output,
        llm.key,
      );
      return parsed;
    }

    // Fallback for providers without native structured output: parse the
    // model's free-form text. Brittle by nature, but only reached for
    // providers we have not wired for structured output.
    this.logger.warn(
      `Provider ${llm.key} has no native structured output; falling back to text parsing for feature ${featureKey}`,
    );
    const raw = await this._processPromptWithProvider(
      prompt,
      assignmentId,
      usageType,
      llm,
      options,
      featureKey,
    );
    const parser = StructuredOutputParser.fromZodSchema(schema);
    return (await parser.parse(raw)) as T;
  }

  async processStructuredPrompt<T>(
    prompt: PromptTemplate,
    assignmentId: number,
    usageType: AIUsageType,
    schema: ZodTypeAny,
    llmKey: string,
    options?: LlmRequestOptions,
  ): Promise<T> {
    this.aiFlags.assertUsageEnabled(usageType);
    const llm = this.router.get(llmKey);

    if (typeof llm.invokeStructured === "function") {
      const input = await this.formatPromptInput(prompt);
      const { parsed, tokenUsage } = await llm.invokeStructured<T>(
        [this.buildMessageFor(llm, input, options)],
        schema,
        options,
      );
      logAiInvocation(this.logger, {
        modelKey: llm.key,
        purpose: "structured_prompt",
        prompt: input,
        response: JSON.stringify(parsed),
        context: {
          assignment_id: assignmentId,
          usage_type: usageType,
          input_tokens: tokenUsage.input,
          output_tokens: tokenUsage.output,
          cached_input_tokens: tokenUsage.cachedInput,
        },
      });
      await this.trackUsageSafely(
        assignmentId,
        usageType,
        tokenUsage.input,
        tokenUsage.output,
        llm.key,
      );
      return parsed;
    }

    const raw = await this._processPromptWithProvider(
      prompt,
      assignmentId,
      usageType,
      llm,
      options,
      "structured_prompt",
    );
    const parser = StructuredOutputParser.fromZodSchema(schema);
    return (await parser.parse(raw)) as T;
  }

  /**
   * Process a text prompt and return the LLM response
   */
  async processPrompt(
    prompt: PromptTemplate | string,
    assignmentId: number,
    usageType: AIUsageType,
    llmKey = "gpt-4o",
    options?: LlmRequestOptions,
  ): Promise<string> {
    // Kill-switch backstop (see processPromptForFeature).
    this.aiFlags.assertUsageEnabled(usageType);
    try {
      const llm = this.router.get(llmKey ?? "gpt-4o");

      return await this._processPromptWithProvider(
        prompt,
        assignmentId,
        usageType,
        llm,
        options,
      );
    } catch (error) {
      this.logger.error(
        `Error processing prompt: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        {
          stack:
            error instanceof Error ? error.stack : "No stack trace available",
          assignmentId,
          usageType,
          errorObject: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        },
      );

      const error_ =
        error instanceof Error
          ? error
          : new Error(`Failed to process prompt: ${JSON.stringify(error)}`);
      throw error_;
    }
  }

  /**
   * Internal method to process a prompt with a specific LLM provider
   */
  private async _processPromptWithProvider(
    prompt: PromptTemplate | string,
    assignmentId: number,
    usageType: AIUsageType,
    llm: any,
    options?: LlmRequestOptions,
    purposeLabel?: string,
  ): Promise<string> {
    let input: string;

    if (typeof prompt === "string") {
      input = prompt;
    } else {
      if (prompt.partialVariables) {
        const stringVariables: { [key: string]: string | null } = {};

        for (const key in prompt.partialVariables) {
          const value = prompt.partialVariables[key];
          if (
            (typeof value === "string" || value === null) &&
            typeof value !== "function"
          ) {
            stringVariables[key] = value;
          }
        }

        const decodedVariables = decodeFields(stringVariables);

        for (const key in decodedVariables) {
          prompt.partialVariables[key] = decodedVariables[key];
        }
      }

      try {
        input = await prompt.format({});
        input = decodeIfBase64(input) || input;
      } catch (formatError: unknown) {
        const errorMessage =
          formatError instanceof Error ? formatError.message : "Unknown error";
        this.logger.error(`Error formatting prompt: ${errorMessage}`, {
          stack:
            formatError instanceof Error
              ? formatError.stack
              : "No stack trace available",
          promptDetails: {
            template: JSON.stringify(prompt.template).slice(0, 100) + "...",
            partialVariables:
              JSON.stringify(prompt.partialVariables || {}).slice(0, 200) +
              "...",
          },
        });
        throw formatError;
      }
    }

    let result: any;

    try {
      result = await llm.invoke(
        [this.buildMessageFor(llm, input, options)],
        options,
      );
    } catch (error) {
      this.logger.error(
        `Provider invocation failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      const error_ =
        error instanceof Error
          ? error
          : new Error(`Failed provider invoke: ${JSON.stringify(error)}`);
      throw error_;
    }

    const response = this.cleanResponse(result.content);

    logAiInvocation(this.logger, {
      modelKey: llm.key,
      purpose: purposeLabel ?? usageType,
      prompt: input,
      response,
      context: {
        assignment_id: assignmentId,
        usage_type: usageType,
        input_tokens: result.tokenUsage?.input,
        output_tokens: result.tokenUsage?.output,
        cached_input_tokens: result.tokenUsage?.cachedInput,
      },
    });

    await this.trackUsageSafely(
      assignmentId,
      usageType,
      result.tokenUsage?.input ?? 0,
      result.tokenUsage?.output ?? 0,
      llm.key,
    );

    return response;
  }

  /**
   * Process a prompt with image data and return the LLM response
   */
  /**
   * Process a prompt with image data and return the LLM response
   */
  async processPromptWithImage(
    prompt: PromptTemplate,
    imageData: string,
    assignmentId: number,
    usageType: AIUsageType,
    llmKey = "gpt-4.1-mini",
    options?: LlmRequestOptions,
  ): Promise<string> {
    // Kill-switch backstop (see processPromptForFeature).
    this.aiFlags.assertUsageEnabled(usageType);
    try {
      const llm = this.router.get(llmKey ?? "gpt-4.1-mini");

      if (prompt.partialVariables) {
        const stringVariables: { [key: string]: string | null } = {};

        for (const key in prompt.partialVariables) {
          const value = prompt.partialVariables[key];
          if (
            (typeof value === "string" || value === null) &&
            typeof value !== "function"
          ) {
            stringVariables[key] = value;
          }
        }

        const decodedVariables = decodeFields(stringVariables);

        for (const key in decodedVariables) {
          prompt.partialVariables[key] = decodedVariables[key];
        }
      }

      let textContent = await prompt.format({});

      textContent = decodeIfBase64(textContent) || textContent;

      const decodedImageData = decodeIfBase64(imageData) || imageData;

      const result = await llm.invokeWithImage(
        textContent,
        decodedImageData,
        options,
      );

      const response = this.cleanResponse(result.content);

      logAiInvocation(this.logger, {
        modelKey: llm.key,
        purpose: usageType,
        prompt: `${textContent} [image omitted]`,
        response,
        context: {
          assignment_id: assignmentId,
          usage_type: usageType,
          input_tokens: result.tokenUsage?.input,
          output_tokens: result.tokenUsage?.output,
          cached_input_tokens: result.tokenUsage?.cachedInput,
        },
      });

      await this.trackUsageSafely(
        assignmentId,
        usageType,
        result.tokenUsage?.input ?? 0,
        result.tokenUsage?.output ?? 0,
        llm.key,
      );

      return response;
    } catch (error) {
      this.logger.error(
        `Error processing prompt with image: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        {
          stack:
            error instanceof Error ? error.stack : "No stack trace available",
          assignmentId,
          usageType,
          errorObject: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        },
      );

      const error_ =
        error instanceof Error
          ? error
          : new Error(
              `Failed to process prompt with image: ${JSON.stringify(error)}`,
            );
      throw error_;
    }
  }

  /**
   * Resolve a PromptTemplate to its final input string, mirroring the
   * formatting the string path performs (template format + optional base64
   * decode). Grading prompts use function partials, so no string-partial
   * decoding is required here; the structured-output path sends this as a
   * single HumanMessage.
   */
  private async formatPromptInput(prompt: PromptTemplate): Promise<string> {
    const input = await prompt.format({});
    return decodeIfBase64(input) || input;
  }

  /**
   * Clean the LLM response by removing code blocks and other formatting
   */
  private cleanResponse(response: string): string {
    return response
      .replaceAll("```json", "")
      .replaceAll("```", "")
      .replaceAll("`", "")
      .trim();
  }

  private async trackUsageSafely(
    assignmentId: number,
    usageType: AIUsageType,
    tokensIn: number,
    tokensOut: number,
    modelKey?: string,
  ): Promise<void> {
    try {
      await this.usageTracker.trackUsage(
        assignmentId,
        usageType,
        tokensIn,
        tokensOut,
        modelKey,
      );
    } catch (error) {
      this.logger.error(
        `AI usage tracking failed after successful provider response for assignment ${assignmentId} (${usageType}): ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }
}
