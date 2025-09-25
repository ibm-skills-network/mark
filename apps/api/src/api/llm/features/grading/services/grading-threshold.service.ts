import { Injectable } from "@nestjs/common";
import { ResponseType } from "@prisma/client";

export interface ThresholdCalculationInput {
  responseText: string;
  questionText: string;
  responseType: ResponseType;
  questionComplexity?: "simple" | "medium" | "complex";
  rubricCount?: number;
}

export interface ThresholdResult {
  shouldUseJudgeLLM: boolean;
  reason: string;
}

@Injectable()
export class GradingThresholdService {
  /**
   * Determine if JudgeLLM should be used based on response length
   */
  shouldUseJudgeLLM(input: ThresholdCalculationInput): ThresholdResult {
    const { responseText, responseType } = input;

    const responseLength = responseText.trim().length;
    const wordCount = this.countWords(responseText);

    // Skip JudgeLLM for multimedia types that don't need text validation
    if (responseType === "VIDEO" || responseType === "AUDIO") {
      return {
        shouldUseJudgeLLM: false,
        reason: `${responseType} submission - text analysis not needed`,
      };
    }

    // Simple length-based check
    if (responseLength < 50) {
      return {
        shouldUseJudgeLLM: false,
        reason: `Very short response (${responseLength} chars, ${wordCount} words) `,
      };
    }

    if (wordCount < 10) {
      return {
        shouldUseJudgeLLM: false,
        reason: `Brief response (${wordCount} words) `,
      };
    }

    return {
      shouldUseJudgeLLM: true,
      reason: `Substantial response (${responseLength} chars, ${wordCount} words) - using JudgeLLM validation`,
    };
  }

  /**
   * Count words in text
   */
  private countWords(text: string): number {
    if (!text || typeof text !== "string") return 0;
    const words = text.trim().match(/\b\w+\b/g);
    return words ? words.length : 0;
  }
}
