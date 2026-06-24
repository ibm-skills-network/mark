/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { StructuredOutputParser } from "@langchain/classic/output_parsers";
import { HumanMessage } from "@langchain/core/messages";
import { PromptTemplate } from "@langchain/core/prompts";
import { Inject, Injectable } from "@nestjs/common";
import { AIUsageType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import type { ZodTypeAny } from "zod";
import { decodeFields, decodeIfBase64 } from "../../../../helpers/decoder";
import { USAGE_TRACKER } from "../../llm.constants";
import { LlmRequestOptions } from "../interfaces/llm-provider.interface";
import { IPromptProcessor } from "../interfaces/prompt-processor.interface";
import { IUsageTracker } from "../interfaces/user-tracking.interface";
import {
  classifyLlmError,
  LlmQuotaExceededError,
} from "../utils/llm-error.util";
import { LlmRouter } from "./llm-router.service";

@Injectable()
export class PromptProcessorService implements IPromptProcessor {
  private readonly logger: Logger;

  // Classification-aware retry budget for a single LLM call. Owns retrying so
  // the OpenAI SDK's blind retry can be disabled at the provider (otherwise the
  // two stack and a 429 gets retried far more than intended). Transient/rate-
  // limit errors are retried; quota and other terminal errors are not.
  private static readonly MAX_LLM_RETRIES = 2;
  private static readonly RETRY_BASE_DELAY_MS = 1000;
  private static readonly RETRY_JITTER_MS = 250;

  // Quota circuit-breaker. When a provider returns insufficient_quota, the
  // account is out of credit / over a billing cap and EVERY subsequent call
  // fails the same way until billing is fixed. Rather than let each grading /
  // translation call make its own doomed request (which is what stretched a
  // billing blip into an hour of failing work), the first quota error opens a
  // per-pod cooldown during which calls fail fast. 60s base + up to 10s jitter
  // so pods — and queued callers on the same pod — don't all probe the
  // recovered key in the same instant and re-trip the limit together.
  private static readonly QUOTA_COOLDOWN_BASE_MS = 60_000;
  private static readonly QUOTA_COOLDOWN_JITTER_MS = 10_000;

  // Wall-clock (ms) until which the quota circuit is open. 0 = closed.
  private quotaCooldownUntil = 0;

  constructor(
    private readonly router: LlmRouter,
    @Inject(USAGE_TRACKER) private readonly usageTracker: IUsageTracker,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: PromptProcessorService.name });
  }

  private quotaCooldownRemainingSeconds(): number {
    return Math.max(
      0,
      Math.ceil((this.quotaCooldownUntil - Date.now()) / 1000),
    );
  }

  private openQuotaCircuit(): number {
    const cooldownMs =
      PromptProcessorService.QUOTA_COOLDOWN_BASE_MS +
      Math.floor(
        Math.random() * PromptProcessorService.QUOTA_COOLDOWN_JITTER_MS,
      );
    this.quotaCooldownUntil = Date.now() + cooldownMs;
    return Math.ceil(cooldownMs / 1000);
  }

  private retryBackoffMs(attempt: number): number {
    return (
      PromptProcessorService.RETRY_BASE_DELAY_MS * 2 ** (attempt - 1) +
      Math.floor(Math.random() * PromptProcessorService.RETRY_JITTER_MS)
    );
  }

  /**
   * Wrap a single provider invocation with classification-aware retries and
   * the quota circuit-breaker. Retries transient/rate-limit failures with
   * exponential backoff; fails fast (and opens the circuit) on quota; rethrows
   * other terminal errors immediately.
   */
  private async withLlmResilience<T>(
    label: string,
    modelKey: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const openFor = this.quotaCooldownRemainingSeconds();
    if (openFor > 0) {
      this.logger.warn("llm.quota.circuit_open", {
        label,
        model: modelKey,
        retry_after_seconds: openFor,
      });
      throw new LlmQuotaExceededError(
        "LLM temporarily unavailable (quota cooldown)",
        { retryAfterSeconds: openFor },
      );
    }

    let attempt = 0;
    for (;;) {
      try {
        return await operation();
      } catch (error) {
        const classified = classifyLlmError(error);

        if (classified.kind === "quota") {
          const retryAfterSeconds = this.openQuotaCircuit();
          this.logger.error("llm.quota_exceeded", {
            label,
            model: modelKey,
            status: classified.status,
            code: classified.code,
            retry_after_seconds: retryAfterSeconds,
          });
          throw new LlmQuotaExceededError(
            "LLM temporarily unavailable (insufficient quota)",
            { retryAfterSeconds, cause: error },
          );
        }

        attempt++;
        if (
          !classified.retryable ||
          attempt > PromptProcessorService.MAX_LLM_RETRIES
        ) {
          throw error instanceof Error
            ? error
            : new Error(`LLM call failed: ${String(error)}`);
        }

        const backoffMs = this.retryBackoffMs(attempt);
        this.logger.warn("llm.retry", {
          label,
          model: modelKey,
          kind: classified.kind,
          status: classified.status,
          attempt,
          max_retries: PromptProcessorService.MAX_LLM_RETRIES,
          backoff_ms: backoffMs,
        });
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
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
      const { parsed, tokenUsage } = await this.withLlmResilience(
        `invokeStructured:${featureKey}`,
        typeof llm?.key === "string" ? llm.key : "unknown",
        () =>
          llm.invokeStructured<T>([new HumanMessage(input)], schema, options),
      );
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
      result = await this.withLlmResilience(
        "invoke",
        typeof llm?.key === "string" ? llm.key : "unknown",
        () => llm.invoke([new HumanMessage(input)], options),
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

      const result = await this.withLlmResilience(
        "invokeWithImage",
        typeof llm?.key === "string" ? llm.key : "unknown",
        () => llm.invokeWithImage(textContent, decodedImageData, options),
      );

      const response = this.cleanResponse(result.content);

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
