import { z } from "zod";

export const GRADING_EFFORTS = ["low", "medium", "high"] as const;
export const gradingEffortSchema = z.enum(GRADING_EFFORTS);
export type GradingEffort = z.infer<typeof gradingEffortSchema>;

export const PART_KINDS = ["text", "file", "image"] as const;

/**
 * One named piece of a submission as the model sees it. Text parts carry
 * `text`; file and image parts carry `base64` bytes and a `mimeType`.
 */
export const partSchema = z
  .object({
    name: z.string().min(1).max(500),
    kind: z.enum(PART_KINDS),
    mimeType: z.string().min(1).max(200).optional(),
    text: z.string().optional(),
    base64: z.string().optional(),
    /**
     * For a file rendered from a document we also send as text: quotes from
     * this part are checked against these text parts first; one none of them
     * holds is accepted as visual_unverified.
     */
    verifyAgainst: z.array(z.string().min(1).max(500)).max(200).optional(),
  })
  .superRefine((part, context) => {
    if (part.kind === "text" && typeof part.text !== "string") {
      context.addIssue({
        code: "custom",
        message: "a text part needs text",
        path: ["text"],
      });
    }
    if (part.kind !== "text" && (!part.base64 || !part.mimeType)) {
      context.addIssue({
        code: "custom",
        message: "a file or image part needs base64 and mimeType",
        path: ["base64"],
      });
    }
  });
export type Part = z.infer<typeof partSchema>;

export const rubricLevelSchema = z.object({
  points: z.number().finite().min(0),
  description: z.string(),
});
export type RubricLevel = z.infer<typeof rubricLevelSchema>;

export const rubricCriterionSchema = z.object({
  id: z.string().min(1).max(100),
  description: z.string(),
  maxPoints: z.number().finite().min(0),
  levels: z.array(rubricLevelSchema).optional(),
});
export type RubricCriterion = z.infer<typeof rubricCriterionSchema>;

export const gradingQuestionSchema = z.object({
  questionId: z.number().int(),
  questionType: z.string().min(1),
  questionText: z.string(),
  rubric: z.object({ criteria: z.array(rubricCriterionSchema).min(1) }),
  totalPoints: z.number().finite().min(0),
  effort: gradingEffortSchema,
});
export type GradingQuestion = z.infer<typeof gradingQuestionSchema>;

export const gradingInputSchema = gradingQuestionSchema.extend({
  parts: z.array(partSchema),
});
export type GradingInput = z.infer<typeof gradingInputSchema>;

export const quoteSchema = z.object({
  part: z.string(),
  text: z.string(),
});
export type Quote = z.infer<typeof quoteSchema>;

export const criterionVerdictSchema = z.object({
  criterionId: z.string(),
  points: z.number(),
  reason: z.string(),
  quotes: z.array(quoteSchema),
  feedback: z.string(),
  /** Kept quotes from file or image parts that no text part could confirm. */
  visualUnverifiedQuotes: z.number().int().min(0),
});
export type CriterionVerdict = z.infer<typeof criterionVerdictSchema>;

/**
 * What the model must return. Strict objects, every key required: OpenAI
 * strict structured output rejects optional keys.
 */
export const modelGradeOutputSchema = z.strictObject({
  verdicts: z.array(
    z.strictObject({
      criterionId: z.string(),
      points: z.number(),
      reason: z.string(),
      quotes: z.array(z.strictObject({ part: z.string(), text: z.string() })),
      feedback: z.string(),
    }),
  ),
  overallFeedback: z.string(),
});
export type ModelGradeOutput = z.infer<typeof modelGradeOutputSchema>;

export const usageSchema = z.object({
  inputTokens: z.number(),
  cachedInputTokens: z.number(),
  outputTokens: z.number(),
  reasoningTokens: z.number(),
});
export type GradingUsage = z.infer<typeof usageSchema>;

export const CHECK_FAILURE_CODES = [
  "missing_verdict",
  "unknown_criterion",
  "duplicate_verdict",
  "points_out_of_bounds",
  "quote_unknown_part",
  "quote_not_found",
  "quote_empty",
  "points_without_evidence",
] as const;
export type CheckFailureCode = (typeof CHECK_FAILURE_CODES)[number];

export const checkFailureSchema = z.object({
  code: z.enum(CHECK_FAILURE_CODES),
  criterionId: z.string().optional(),
  detail: z.string(),
});
export type CheckFailure = z.infer<typeof checkFailureSchema>;

/**
 * Spike/admin debug block, returned only when a caller asks for it. Holds
 * model output about learner content, so it is never logged or persisted.
 */
export const gradingDebugSchema = z.object({
  /** The model's reasoning summary, every attempt in order. */
  reasoningSummary: z.array(z.string()),
  /** The parts as sent, without their content. */
  parts: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(PART_KINDS),
      mimeType: z.string().optional(),
      estimatedTokens: z.number(),
    }),
  ),
  /** Raw model JSON per attempt, before any check. */
  rawOutputs: z.array(z.string()),
  /** Each quote's outcome and the rule that decided it. */
  quoteChecks: z.array(
    z.object({
      criterionId: z.string(),
      part: z.string(),
      accepted: z.boolean(),
      rule: z.string().optional(),
      code: z.string().optional(),
    }),
  ),
});
export type GradingDebug = z.infer<typeof gradingDebugSchema>;

/** Kept quotes: confirmed against text, or visual and unconfirmed. */
export const evidenceCountsSchema = z.object({
  verified: z.number().int().min(0),
  visualUnverified: z.number().int().min(0),
});
export type EvidenceCounts = z.infer<typeof evidenceCountsSchema>;

export const gradingResultSchema = z.object({
  verdicts: z.array(criterionVerdictSchema),
  totalPoints: z.number(),
  overallFeedback: z.string(),
  usage: usageSchema,
  model: z.string(),
  effort: gradingEffortSchema,
  promptVersion: z.string(),
  checkFailures: z.array(checkFailureSchema),
  evidence: evidenceCountsSchema,
  debug: gradingDebugSchema.optional(),
});
export type GradingResult = z.infer<typeof gradingResultSchema>;

export const GRADING_FAILURE_CODES = [
  "grading.v3.invalid_input",
  "grading.v3.over_budget",
  "grading.v3.model_unavailable",
  "grading.v3.model_error",
  "grading.v3.check_failed",
] as const;
export type GradingFailureCode = (typeof GRADING_FAILURE_CODES)[number];

export interface GradingFailure {
  code: GradingFailureCode;
  message: string;
  /** True when the same input may succeed later (model outage, rate limit). */
  retryable: boolean;
  checkFailures: CheckFailure[];
  usage: GradingUsage;
  model: string | undefined;
  effort: GradingEffort;
  promptVersion: string;
  estimatedTokens?: number;
  tokenBudget?: number;
  debug?: GradingDebug;
}

export type GradingOutcome =
  | { status: "graded"; result: GradingResult }
  | { status: "failed"; failure: GradingFailure };

export const ZERO_USAGE: GradingUsage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};

export function addUsage(a: GradingUsage, b: GradingUsage): GradingUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
  };
}

/** Structured logger shape shared by the Nest services and the spike runner. */
export interface GradingLogger {
  debug(message: string, meta?: Record<string, unknown>): unknown;
  info(message: string, meta?: Record<string, unknown>): unknown;
  warn(message: string, meta?: Record<string, unknown>): unknown;
  error(message: string, meta?: Record<string, unknown>): unknown;
}

/** A logger that adds `context` to every entry's metadata. */
export function withLogContext(
  logger: GradingLogger,
  context: Record<string, unknown>,
): GradingLogger {
  return {
    debug: (message, meta) => logger.debug(message, { ...context, ...meta }),
    info: (message, meta) => logger.info(message, { ...context, ...meta }),
    warn: (message, meta) => logger.warn(message, { ...context, ...meta }),
    error: (message, meta) => logger.error(message, { ...context, ...meta }),
  };
}
