import { z } from "zod";
import { BoundingBox } from "src/api/attempt/services/structured-content.models";

export interface RubricCriterionLevel {
  description: string;
  points: number;
}

export interface RubricCriterion {
  id: string;
  rubricQuestion: string;
  description: string;
  criteria: RubricCriterionLevel[];
  maxPoints: number;
}

export type EvidenceSourceType = "text" | "file" | "image" | "url" | "unknown";

export type EvidenceAnchor =
  | {
      type: "text";
      startOffset: number;
      endOffset: number;
    }
  | {
      type: "file";
      page: number;
      blockId?: string;
      lineStart?: number;
      lineEnd?: number;
    }
  | {
      type: "image";
      page?: number;
      boundingBox?: BoundingBox;
      ocrText?: string;
      imageId?: string;
    }
  | {
      type: "url";
      url: string;
      paragraphIndex?: number;
      selector?: string;
    };

export interface ExtractedChunk {
  chunkId: string;
  text: string;
  sourceType: EvidenceSourceType;
  sourceId: string;
  anchor: EvidenceAnchor;
  hash: string;
  metadata?: {
    filename?: string;
    mimeType?: string;
    url?: string;
    pageCount?: number;
    imageIndex?: number;
    structured?: boolean;
    checksum?: string;
    /** Mirrors ContentBlock.pinnedEvidence: always reaches the LLM validator. */
    pinned?: boolean;
  };
}

export type EvidenceRetrievalStrategy = "llm" | "search";

export interface CriterionEvidenceRequest {
  criterion: RubricCriterion;
  question: string;
  chunks: ExtractedChunk[];
  assignmentId: number;
  language?: string;
  maxEvidence?: number;
  strategy?: EvidenceRetrievalStrategy;
  modelOverride?: string;
  modelOverrideIsFinal?: boolean;
}

export interface CriterionEvidence {
  chunkId: string;
  quote: string;
  anchor: EvidenceAnchor;
  sourceType: EvidenceSourceType;
  sourceId: string;
  relevanceScore: number;
  searchScore?: number;
  contradiction?: boolean;
}

export interface CriterionEvidenceResponse {
  criterionId: string;
  evidence: CriterionEvidence[];
  strategyUsed: EvidenceRetrievalStrategy;
  retrievedAt: string;
  debug?: {
    candidateCount: number;
    validatedCount: number;
  };
}

export type ConfidenceLevel = "high" | "medium" | "low";

export interface CriterionGrade {
  criterionId: string;
  rubricQuestion: string;
  pointsAwarded: number;
  maxPoints: number;
  rationale: string;
  nextStep?: string;
  citations: string[];
  confidence: ConfidenceLevel;
  decision: "meets" | "partially_meets" | "does_not_meet";
  evidence: CriterionEvidence[];
  attempt: number;
  gradedAt: string;
  modelUsed: string;
}

export interface SupportScoreBreakdown {
  evidenceCount: number;
  avgRelevance: number;
  contradictionCount: number;
  judgePenalty: number;
  supportScore: number;
}

export interface JudgeIssue {
  criterionId: string;
  severity: "low" | "medium" | "high";
  issue: string;
  evidenceIds?: string[];
}

export interface JudgeCritique {
  approved: boolean;
  issues: JudgeIssue[];
  summary?: string;
}

export interface CriterionAttempt {
  attempt: number;
  grade: CriterionGrade;
  support: SupportScoreBreakdown;
  judgeIssues: JudgeIssue[];
}

export interface GradeSummary {
  totalPoints: number;
  maxPoints: number;
  criteria: CriterionGrade[];
  allCitations: string[];
  allRationales: string[];
  compiledAt: string;
}

export interface EvidenceAuditLog {
  rubricHash: string;
  chunkHashes: string[];
  evidenceRetrieval: CriterionEvidenceResponse[];
  gradingAttempts: CriterionAttempt[];
  judgeCritiques: JudgeCritique[];
  finalSelection: {
    criterionId: string;
    attempt: number;
    supportScore: number;
    reason: string;
  }[];
  llmCalls: Array<{
    purpose: "retrieval" | "validation" | "grading" | "judge";
    model: string;
    promptHash: string;
    responseHash: string;
    durationMs: number;
  }>;
  createdAt: string;
}

export interface ModelSelectionConfig {
  retrievalModel: string;
  gradingModel: string;
  judgeModel: string;
}

/** Pin the backend revision as well as the provider key for stable grading. */
export const DETERMINISTIC_GRADING_MODEL_SNAPSHOT = "gpt-4o-mini-2024-07-18";

export function getDeterministicGradingOptions(modelKey: string) {
  if (modelKey === "gpt-4o-mini") {
    return {
      temperature: 0,
      maxRetries: 1,
      modelName: DETERMINISTIC_GRADING_MODEL_SNAPSHOT,
    };
  }

  // Original GPT-5-family reasoning models reject sampling controls. Keep
  // admin-selected GPT-5 providers usable without pretending they are seeded
  // or temperature-controlled.
  if (modelKey.startsWith("gpt-5")) {
    return { maxRetries: 1 };
  }

  return { temperature: 0, maxRetries: 1 };
}

export const DEFAULT_MODEL_SELECTION: ModelSelectionConfig = {
  // This grading path requires controllable sampling. The original GPT-5
  // mini/nano models reject temperature, so use one explicit model for all
  // three stages and pin it at the call sites.
  retrievalModel: "gpt-4o-mini",
  gradingModel: "gpt-4o-mini",
  judgeModel: "gpt-4o-mini",
};

export const CriterionGradeSchema = z.object({
  score: z.number().min(0),
  rationale: z.string().min(20),
  citations: z.array(z.string()).min(1),
  confidence: z.enum(["high", "medium", "low"]),
  nextStep: z.string().min(10).optional(),
});

export const EvidenceValidationSchema = z.object({
  evidence: z
    .array(
      z.object({
        chunkId: z.string(),
        relevance: z.enum(["supports", "partial", "contradicts", "irrelevant"]),
        note: z.string().optional(),
      }),
    )
    .min(0),
});

export const JudgeCritiqueSchema = z.object({
  approved: z.boolean(),
  summary: z.string().optional(),
  issues: z
    .array(
      z.object({
        criterionId: z.string(),
        severity: z.enum(["low", "medium", "high"]),
        issue: z.string(),
        evidenceIds: z.array(z.string()).optional(),
      }),
    )
    .default([]),
});

export const GradeSummarySchema = z.object({
  totalPoints: z.number().min(0),
  maxPoints: z.number().min(0),
  criteria: z.array(
    z.object({
      criterionId: z.string(),
      rubricQuestion: z.string(),
      pointsAwarded: z.number().min(0),
      maxPoints: z.number().min(0),
      rationale: z.string(),
      citations: z.array(z.string()),
      confidence: z.enum(["high", "medium", "low"]),
      decision: z.enum(["meets", "partially_meets", "does_not_meet"]),
    }),
  ),
  allCitations: z.array(z.string()),
  allRationales: z.array(z.string()),
  compiledAt: z.string(),
});
