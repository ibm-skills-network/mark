import { AIUsageType } from "@prisma/client";

export interface UsageDetail {
  /** The part of tokensIn served from the prompt cache. */
  cachedInputTokens?: number;
  /** Billed, but the output could not be used. */
  failed?: boolean;
}

export interface IUsageTracker {
  /**
   * Track LLM usage for a usage type; assignmentId is null for a call that
   * has no assignment, which only reaches the daily ledger.
   */
  trackUsage(
    assignmentId: number | null,
    usageType: AIUsageType,
    tokensIn: number,
    tokensOut: number,
    modelKey?: string,
    detail?: UsageDetail,
  ): Promise<void>;
}
