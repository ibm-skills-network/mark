/**
 * Image Description Service
 *
 * Uses GPT-5 nano vision to generate brief, criterion-aware descriptions
 * of images extracted from student submissions.
 *
 * Key features:
 * - Fast (GPT-5 nano is fastest vision model)
 * - Cheap (lowest cost per image)
 * - Criterion-aware (descriptions tailored to grading focus)
 * - Parallel processing (describe multiple images simultaneously)
 */

import { Inject, Injectable } from "@nestjs/common";
import { AIUsageType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { PromptTemplate } from "@langchain/core/prompts";
import { ContentBlock } from "src/api/attempt/services/structured-content.models";
import { IPromptProcessor } from "../../../core/interfaces/prompt-processor.interface";
import { PROMPT_PROCESSOR } from "../../../llm.constants";

export interface ImageDescriptionResult {
  blockId: string;
  description: string;
  success: boolean;
  error?: string;
}

@Injectable()
export class ImageDescriptionService {
  private readonly logger: Logger;

  constructor(
    @Inject(PROMPT_PROCESSOR)
    private readonly promptProcessor: IPromptProcessor,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({
      context: ImageDescriptionService.name,
    });
  }

  /**
   * Describe multiple images in parallel using GPT-5 nano vision
   * Descriptions are criterion-aware (tailored to what's being graded)
   */
  async describeImagesForGrading(
    imageBlocks: ContentBlock[],
    criteriaContext: string,
    questionText: string,
    assignmentId: number,
  ): Promise<Map<string, string>> {
    if (imageBlocks.length === 0) {
      this.logger.debug("No images to describe");
      return new Map();
    }

    this.logger.debug(
      `Describing ${imageBlocks.length} images using GPT-5 nano vision`,
    );

    const startTime = Date.now();

    const descriptionPromises = imageBlocks.map((imageBlock) =>
      this.describeOneImage(
        imageBlock,
        criteriaContext,
        questionText,
        assignmentId,
      ),
    );

    const results =
      await Promise.allSettled<ImageDescriptionResult>(descriptionPromises);

    const descriptionsMap = new Map<string, string>();
    let successCount = 0;
    let failureCount = 0;

    for (const [index, result] of results.entries()) {
      const imageBlock = imageBlocks[index];

      if (result.status === "fulfilled" && result.value.success) {
        descriptionsMap.set(imageBlock.blockId, result.value.description);
        successCount++;
      } else {
        const errorMessage =
          result.status === "rejected"
            ? result.reason instanceof Error
              ? result.reason.message
              : String(result.reason)
            : result.value.error || "Unknown error";

        this.logger.warn(
          `Failed to describe image ${imageBlock.blockId}: ${errorMessage}`,
        );

        descriptionsMap.set(
          imageBlock.blockId,
          "[Image present but description unavailable]",
        );
        failureCount++;
      }
    }

    const duration = Date.now() - startTime;

    this.logger.debug(
      `Image description complete: ${successCount} succeeded, ${failureCount} failed in ${duration}ms`,
    );

    return descriptionsMap;
  }

  /**
   * Describe a single image using GPT-5 nano vision
   */
  private async describeOneImage(
    imageBlock: ContentBlock,
    criteriaContext: string,
    questionText: string,
    assignmentId: number,
  ): Promise<ImageDescriptionResult> {
    try {
      if (!imageBlock.imageData) {
        return {
          blockId: imageBlock.blockId,
          description: "",
          success: false,
          error: "No image data available",
        };
      }

      const prompt = this.buildImageDescriptionPrompt(
        criteriaContext,
        questionText,
      );

      this.logger.debug(
        `Describing image ${imageBlock.blockId} on page ${imageBlock.page}`,
      );

      const description = await this.promptProcessor.processPromptWithImage(
        prompt,
        imageBlock.imageData,
        assignmentId,
        AIUsageType.ASSIGNMENT_GRADING,
        "gpt-5-nano",
        {
          imageDetail: "low",
        },
      );

      const cleanedDescription = description.trim();

      if (!cleanedDescription || cleanedDescription.length < 10) {
        return {
          blockId: imageBlock.blockId,
          description: "",
          success: false,
          error: "Description too short or empty",
        };
      }

      return {
        blockId: imageBlock.blockId,
        description: cleanedDescription,
        success: true,
      };
    } catch (error) {
      this.logger.error(
        `Error describing image ${imageBlock.blockId}: ${error instanceof Error ? error.message : String(error)}`,
      );

      return {
        blockId: imageBlock.blockId,
        description: "",
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Build criterion-aware prompt for image description
   */
  private buildImageDescriptionPrompt(
    criteriaContext: string,
    questionText: string,
  ): PromptTemplate {
    return new PromptTemplate({
      template: `You are analyzing an image from a student submission for academic grading.

QUESTION BEING GRADED:
{question}

GRADING CRITERIA FOCUS:
{criteria}

Provide a BRIEF (2-3 sentence) description of this image that focuses on aspects relevant to the grading criteria above.

Focus on:
- What the image shows (chart type, diagram structure, screenshot content, etc.)
- Key data or information presented
- How it relates to the criteria being evaluated

Keep it concise, factual, and objective. Do NOT grade or evaluate - just describe what you see.`,
      inputVariables: [],
      partialVariables: {
        question: () => questionText,
        criteria: () => criteriaContext,
      },
    });
  }
}
