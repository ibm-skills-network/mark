/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { HumanMessage } from "@langchain/core/messages";
import { PromptTemplate } from "@langchain/core/prompts";
import { Inject, Injectable } from "@nestjs/common";
import { AIUsageType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { decodeFields, decodeIfBase64 } from "../../../../helpers/decoder";
import { USAGE_TRACKER } from "../../llm.constants";
import { IPromptProcessor } from "../interfaces/prompt-processor.interface";
import { IUsageTracker } from "../interfaces/user-tracking.interface";
import { LlmRouter } from "./llm-router.service";

@Injectable()
export class PromptProcessorService implements IPromptProcessor {
  private readonly logger: Logger;

  constructor(
    private readonly router: LlmRouter,
    @Inject(USAGE_TRACKER) private readonly usageTracker: IUsageTracker,
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
  ): Promise<string> {
    try {
      const llm = await this.router.getForFeatureWithFallback(
        featureKey,
        fallbackModel,
      );
      console.log(
        `Processing prompt for feature ${featureKey} with model ${llm.key}`,
      );

      return await this._processPromptWithProvider(
        prompt,
        assignmentId,
        usageType,
        llm,
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
   * Process a text prompt and return the LLM response
   */
  async processPrompt(
    prompt: PromptTemplate,
    assignmentId: number,
    usageType: AIUsageType,
    llmKey = "gpt-4o",
  ): Promise<string> {
    try {
      const llm = this.router.get(llmKey ?? "gpt-4o");

      return await this._processPromptWithProvider(
        prompt,
        assignmentId,
        usageType,
        llm,
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
    prompt: PromptTemplate,
    assignmentId: number,
    usageType: AIUsageType,
    llm: any,
  ): Promise<string> {
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

    let input: string;
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
            JSON.stringify(prompt.partialVariables || {}).slice(0, 200) + "...",
        },
      });
      throw formatError;
    }

    try {
      const result = await llm.invoke([new HumanMessage(input)]);
      const response = this.cleanResponse(result.content);
      await this.usageTracker.trackUsage(
        assignmentId,
        usageType,
        result.tokenUsage.input,
        result.tokenUsage.output,
        llm.key,
      );

      return response;
    } catch (error) {
      console.log("The issue is:", error);
    }
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

      const result = await llm.invokeWithImage(textContent, decodedImageData);

      const response = this.cleanResponse(result.content);

      await this.usageTracker.trackUsage(
        assignmentId,
        usageType,
        result.tokenUsage.input,
        result.tokenUsage.output,
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
   * Clean the LLM response by removing code blocks and other formatting
   */
  private cleanResponse(response: string): string {
    return response
      .replaceAll("```json", "")
      .replaceAll("```", "")
      .replaceAll("`", "")
      .trim();
  }
}
