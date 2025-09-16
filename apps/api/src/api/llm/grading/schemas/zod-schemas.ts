import { z } from "zod";

export const CriterionAwardSchema = z.object({
  criterionId: z.string().min(1),
  awarded: z.number().min(0).finite(),
  maxPoints: z.number().min(0).finite(),
  justification: z.string().min(1).max(500).trim(),
  evidence: z.string().max(1000).trim().optional(),
});

export const GradeSchema = z
  .object({
    criteriaAwards: z.array(CriterionAwardSchema).min(1),
    totalAwarded: z.number().min(0).finite(),
    totalMax: z.number().min(0.1).finite(),
    overallFeedback: z.string().max(1000).trim(),
    confidence: z.number().min(0).max(1).finite(),
  })
  .refine(
    (data) => {
      const calculatedTotal = data.criteriaAwards.reduce(
        (sum, award) => sum + award.awarded,
        0,
      );
      return Math.abs(calculatedTotal - data.totalAwarded) <= 0.1;
    },
    {
      message:
        "totalAwarded must equal sum of criterion awards (tolerance: 0.1)",
      path: ["totalAwarded"],
    },
  )
  .refine(
    (data) => {
      const calculatedMax = data.criteriaAwards.reduce(
        (sum, award) => sum + award.maxPoints,
        0,
      );
      return Math.abs(calculatedMax - data.totalMax) <= 0.1;
    },
    {
      message:
        "totalMax must equal sum of criterion maxPoints (tolerance: 0.1)",
      path: ["totalMax"],
    },
  )
  .refine((data) => data.totalAwarded <= data.totalMax + 0.1, {
    message: "totalAwarded cannot exceed totalMax",
    path: ["totalAwarded"],
  });

export const ValidatedGradeSchema = z
  .object({
    criteriaAwards: z.array(CriterionAwardSchema).min(1),
    totalAwarded: z.number().min(0).finite(),
    totalMax: z.number().min(0.1).finite(),
    overallFeedback: z.string().max(1000).trim(),
    confidence: z.number().min(0).max(1).finite(),
    isValid: z.boolean(),
    validationErrors: z.array(z.string()),
    arithmeticFixed: z.boolean().default(false),
  })
  .refine(
    (data) => {
      const calculatedTotal = data.criteriaAwards.reduce(
        (sum, award) => sum + award.awarded,
        0,
      );
      return Math.abs(calculatedTotal - data.totalAwarded) <= 0.1;
    },
    {
      message:
        "totalAwarded must equal sum of criterion awards (tolerance: 0.1)",
      path: ["totalAwarded"],
    },
  )
  .refine(
    (data) => {
      const calculatedMax = data.criteriaAwards.reduce(
        (sum, award) => sum + award.maxPoints,
        0,
      );
      return Math.abs(calculatedMax - data.totalMax) <= 0.1;
    },
    {
      message:
        "totalMax must equal sum of criterion maxPoints (tolerance: 0.1)",
      path: ["totalMax"],
    },
  )
  .refine((data) => data.totalAwarded <= data.totalMax + 0.1, {
    message: "totalAwarded cannot exceed totalMax",
    path: ["totalAwarded"],
  });

export const EvidenceVerificationSchema = z.object({
  ok: z.boolean(),
  invalidCriteriaIds: z.array(z.string()),
  details: z.array(
    z.object({
      criterionId: z.string(),
      issue: z.enum([
        "missing_evidence",
        "evidence_not_found",
        "fuzzy_match_failed",
      ]),
      evidence: z.string().optional(),
    }),
  ),
});

export const JudgeComparisonSchema = z.object({
  graderVsJudgeA: z.object({
    totalDelta: z.number(),
    criterionDeltas: z.array(
      z.object({
        criterionId: z.string(),
        delta: z.number(),
      }),
    ),
    agreementPct: z.number().min(0).max(1),
  }),
  judgeAVsJudgeB: z
    .object({
      totalDelta: z.number(),
      criterionDeltas: z.array(
        z.object({
          criterionId: z.string(),
          delta: z.number(),
        }),
      ),
      agreementPct: z.number().min(0).max(1),
    })
    .optional(),
});

export const TiebreakResultSchema = z.object({
  method: z.enum(["third_judge", "meta_decider"]),
  result: GradeSchema.optional(),
  metaDecision: z
    .enum(["accept_grader", "accept_judges", "tiebreak"])
    .optional(),
  confidence: z.number().min(0).max(1),
});

export const FinalGradeSchema = z.object({
  selectedSource: z.enum(["grader", "judges", "tiebreak"]),
  grade: GradeSchema,
  reasoning: z.string().max(500),
  processingSteps: z.array(
    z.enum([
      "grade",
      "validate",
      "judgeA",
      "judgeB",
      "evidence",
      "compare",
      "tiebreak",
      "decision",
    ]),
  ),
  metadata: z.object({
    totalProcessingTimeMs: z.number(),
    llmCalls: z.number(),
    earlyExitReason: z.string().optional(),
  }),
});

export const GradingContextSchema = z.object({
  questionId: z.string().min(1),
  learnerAnswer: z.string().min(1).max(50_000),
  rubric: z
    .array(
      z.object({
        id: z.string().min(1),
        description: z.string().min(10).max(2000),
        maxPoints: z.number().min(0.1).max(1000).finite(),
        keywords: z.array(z.string().min(1)).optional(),
      }),
    )
    .min(1)
    .max(20),
  questionType: z.enum([
    "TEXT",
    "UPLOAD",
    "URL",
    "TRUE_FALSE",
    "SINGLE_CORRECT",
    "MULTIPLE_CORRECT",
  ]),
  responseType: z.string().max(50).optional(),
  timeout: z.number().min(5000).max(300_000).default(60_000),
  maxRetries: z.number().min(0).max(5).default(2),
});

export const GraphStateSchema = z.object({
  context: GradingContextSchema,
  graderResult: ValidatedGradeSchema.optional(),
  judgeAResult: GradeSchema.optional(),
  judgeBResult: GradeSchema.optional(),
  evidenceVerification: EvidenceVerificationSchema.optional(),
  comparison: JudgeComparisonSchema.optional(),
  tiebreakResult: TiebreakResultSchema.optional(),
  finalGrade: FinalGradeSchema.optional(),
  errors: z.array(z.string()).default([]),
  currentStep: z.string(),
  shouldContinue: z.boolean().default(true),
});

export const ErrorRecoverySchema = z.object({
  attempts: z.number().min(0).max(10),
  lastError: z.string().optional(),
  recoveryStrategy: z.enum(["retry", "fallback", "skip", "abort"]),
  fallbackUsed: z.boolean().default(false),
});

export const CircuitBreakerSchema = z.object({
  failures: z.number().min(0),
  lastFailure: z.number().optional(),
  isOpen: z.boolean().default(false),
  resetTimeout: z.number().min(1000).default(60_000),
});

export const ProcessingMetricsSchema = z.object({
  nodeExecutionTimes: z.record(z.string(), z.number()),
  memoryUsage: z.number().optional(),
  llmTokensUsed: z.number().min(0).default(0),
  cacheHits: z.number().min(0).default(0),
});

export type CriterionAward = z.infer<typeof CriterionAwardSchema>;
export type Grade = z.infer<typeof GradeSchema>;
export type ValidatedGrade = z.infer<typeof ValidatedGradeSchema>;
export type EvidenceVerification = z.infer<typeof EvidenceVerificationSchema>;
export type JudgeComparison = z.infer<typeof JudgeComparisonSchema>;
export type TiebreakResult = z.infer<typeof TiebreakResultSchema>;
export type FinalGrade = z.infer<typeof FinalGradeSchema>;
export type GradingContext = z.infer<typeof GradingContextSchema>;
export type GraphState = z.infer<typeof GraphStateSchema>;
export type ErrorRecovery = z.infer<typeof ErrorRecoverySchema>;
export type CircuitBreaker = z.infer<typeof CircuitBreakerSchema>;
export type ProcessingMetrics = z.infer<typeof ProcessingMetricsSchema>;
