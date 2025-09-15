export interface PolicyThresholds {
  TAU_TOTAL: number;
  TAU_CRITERION: number;
  CONFIDENCE_THRESHOLD: number;
  AGREEMENT_THRESHOLD: number;
  MAX_RETRIES: number;
  EVIDENCE_REQUIRED: boolean;
}

export interface EarlyExitPolicy {
  ACCEPT_ON_HIGH_CONFIDENCE: boolean;
  SKIP_JUDGES_ON_SIMPLE_QUESTIONS: boolean;
  MCQ_AUTO_ACCEPT: boolean;
  TRUE_FALSE_AUTO_ACCEPT: boolean;
}

export interface GradingPolicyConfig {
  thresholds: PolicyThresholds;
  earlyExit: EarlyExitPolicy;
  tiebreakStrategy: "third_judge" | "meta_decider" | "hybrid";
}

export const DEFAULT_POLICY_CONFIG: GradingPolicyConfig = {
  thresholds: {
    TAU_TOTAL: 2,
    TAU_CRITERION: 1,
    CONFIDENCE_THRESHOLD: 0.7,
    AGREEMENT_THRESHOLD: 0.6,
    MAX_RETRIES: 2,
    EVIDENCE_REQUIRED: true,
  },
  earlyExit: {
    ACCEPT_ON_HIGH_CONFIDENCE: true,
    SKIP_JUDGES_ON_SIMPLE_QUESTIONS: true,
    MCQ_AUTO_ACCEPT: true,
    TRUE_FALSE_AUTO_ACCEPT: true,
  },
  tiebreakStrategy: "hybrid",
};

export const createDynamicThresholds = (
  totalMax: number,
): PolicyThresholds => ({
  ...DEFAULT_POLICY_CONFIG.thresholds,
  TAU_TOTAL: Math.max(1, totalMax * 0.05),
  TAU_CRITERION: Math.max(0.5, totalMax * 0.02),
});

export const getQuestionTypePolicy = (
  questionType: string,
): Partial<EarlyExitPolicy> => {
  switch (questionType) {
    case "TRUE_FALSE":
    case "SINGLE_CORRECT":
    case "MULTIPLE_CORRECT": {
      return {
        MCQ_AUTO_ACCEPT: true,
        SKIP_JUDGES_ON_SIMPLE_QUESTIONS: true,
      };
    }

    case "TEXT":
    case "UPLOAD": {
      return {
        MCQ_AUTO_ACCEPT: false,
        SKIP_JUDGES_ON_SIMPLE_QUESTIONS: false,
      };
    }

    default: {
      return {};
    }
  }
};
