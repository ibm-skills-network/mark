import { AIUsageType } from "@prisma/client";

export interface IUsageTracker {
  /**
   * Track LLM usage for a specific assignment and usage type
   */
  trackUsage(
    assignmentId: number,
    usageType: AIUsageType,
    tokensIn: number,
    tokensOut: number,
    modelKey?: string,
  ): Promise<void>;
}
