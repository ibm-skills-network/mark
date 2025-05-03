import { PromptTemplate } from "@langchain/core/prompts";
import { AIUsageType } from "@prisma/client";

export interface IPromptProcessor {
  /**
   * Process a text prompt and return the LLM response
   */
  processPrompt(
    prompt: string | PromptTemplate,
    assignmentId: number,
    usageType: AIUsageType,
    llmKey?: string,
  ): Promise<string>;

  /**
   * Process a prompt with image data and return the LLM response
   */
  processPromptWithImage(
    prompt: PromptTemplate,
    imageData: string,
    assignmentId: number,
    usageType: AIUsageType,
    llmKey?: string,
  ): Promise<string>;
}
