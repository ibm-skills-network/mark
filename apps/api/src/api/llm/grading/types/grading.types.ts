export interface CriterionAwardData {
  criterionId: string;
  awarded: number;
  maxPoints: number;
  justification: string;
  evidence?: string;
}

export interface GradeData {
  criteriaAwards: CriterionAwardData[];
  totalAwarded: number;
  totalMax: number;
  overallFeedback: string;
  confidence: number;
}

export interface ValidatedGradeData extends GradeData {
  isValid: boolean;
  validationErrors: string[];
  arithmeticFixed: boolean;
}

export interface EvidenceVerificationData {
  ok: boolean;
  invalidCriteriaIds: string[];
  details: Array<{
    criterionId: string;
    issue: "missing_evidence" | "evidence_not_found" | "fuzzy_match_failed";
    evidence?: string;
  }>;
}

export interface JudgeComparisonData {
  graderVsJudgeA: {
    totalDelta: number;
    criterionDeltas: Array<{
      criterionId: string;
      delta: number;
    }>;
    agreementPct: number;
  };
  judgeAVsJudgeB?: {
    totalDelta: number;
    criterionDeltas: Array<{
      criterionId: string;
      delta: number;
    }>;
    agreementPct: number;
  };
}

export interface TiebreakResultData {
  method: "third_judge" | "meta_decider";
  result?: GradeData;
  metaDecision?: "accept_grader" | "accept_judges" | "tiebreak";
  confidence: number;
}

export interface FinalGradeData {
  selectedSource: "grader" | "judges" | "tiebreak";
  grade: GradeData;
  reasoning: string;
  processingSteps: Array<
    | "grade"
    | "validate"
    | "judgeA"
    | "judgeB"
    | "evidence"
    | "compare"
    | "tiebreak"
    | "decision"
  >;
  metadata: {
    totalProcessingTimeMs: number;
    llmCalls: number;
    earlyExitReason?: string;
  };
}

export interface RubricCriterion {
  id: string;
  description: string;
  maxPoints: number;
  keywords?: string[];
}

export interface GradingContextData {
  questionId: string;
  learnerAnswer: string;
  rubric: RubricCriterion[];
  questionType:
    | "TEXT"
    | "UPLOAD"
    | "URL"
    | "TRUE_FALSE"
    | "SINGLE_CORRECT"
    | "MULTIPLE_CORRECT";
  responseType?: string;
  timeout: number;
  maxRetries: number;
}

export interface ErrorRecoveryData {
  attempts: number;
  lastError?: string;
  recoveryStrategy: "retry" | "fallback" | "skip" | "abort";
  fallbackUsed: boolean;
}

export interface CircuitBreakerData {
  failures: number;
  lastFailure?: number;
  isOpen: boolean;
  resetTimeout: number;
}

export interface ProcessingMetricsData {
  nodeExecutionTimes: Record<string, number>;
  memoryUsage?: number;
  llmTokensUsed: number;
  cacheHits: number;
}

export interface GraphStateData {
  context: GradingContextData;
  graderResult?: ValidatedGradeData;
  judgeAResult?: GradeData;
  judgeBResult?: GradeData;
  evidenceVerification?: EvidenceVerificationData;
  comparison?: JudgeComparisonData;
  tiebreakResult?: TiebreakResultData;
  finalGrade?: FinalGradeData;
  errors: string[];
  currentStep: string;
  shouldContinue: boolean;
}

export interface LLMGradingRequest {
  questionId: string;
  learnerAnswer: string;
  rubric: RubricCriterion[];
  questionType: string;
  responseType?: string;
  timeout?: number;
}

export interface LLMJudgeRequest {
  questionId: string;
  learnerAnswer: string;
  rubric: RubricCriterion[];
  specificCriteria?: string[];
}

export interface MetaDecisionFeatures {
  deltaA: number;
  deltaB: number;
  agreementPct: number;
  evidenceDensity: number;
}

export type MetaDecision = "accept_grader" | "accept_judges" | "tiebreak";

export interface EvidenceMatch {
  quote: string;
  position: number;
  similarity: number;
  method: "exact" | "fuzzy" | "keyword";
}

export interface PolicyDecision {
  selectedSource: "grader" | "judges" | "tiebreak";
  reasoning: string;
  confidence: number;
  riskLevel: "low" | "medium" | "high";
  fallbackUsed: boolean;
}

export interface DecisionContext {
  questionType?: string;
  totalMax?: number;
  processingTime?: number;
  errorCount?: number;
  fallbackUsed?: boolean;
}
