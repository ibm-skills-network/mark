import {
  CircuitBreakerData,
  ErrorRecoveryData,
  GradingContextData,
  GraphStateData,
  ProcessingMetricsData,
} from "../types/grading.types";

export interface GradingGraphState extends GraphStateData {
  retry_count: number;
  processing_start_time: number;
  error_recovery: ErrorRecoveryData;
  processing_metrics: ProcessingMetricsData;
  node_circuit_breakers: Record<string, CircuitBreakerData>;
  fallback_used: boolean;
  max_processing_time: number;
}

export const initialState = (
  context: GradingContextData,
): GradingGraphState => ({
  context,
  graderResult: undefined,
  judgeAResult: undefined,
  judgeBResult: undefined,
  evidenceVerification: undefined,
  comparison: undefined,
  tiebreakResult: undefined,
  finalGrade: undefined,
  errors: [],
  currentStep: "grade",
  shouldContinue: true,
  retry_count: 0,
  processing_start_time: Date.now(),
  error_recovery: {
    attempts: 0,
    recoveryStrategy: "retry",
    fallbackUsed: false,
  },
  processing_metrics: {
    nodeExecutionTimes: {},
    llmTokensUsed: 0,
    cacheHits: 0,
  },
  node_circuit_breakers: {},
  fallback_used: false,
  max_processing_time: context.timeout || 60_000,
});

export const updateState = (
  state: GradingGraphState,
  updates: Partial<GradingGraphState>,
): GradingGraphState => ({
  ...state,
  ...updates,
});

export const addError = (
  state: GradingGraphState,
  error: string,
  nodeName?: string,
): GradingGraphState => {
  const errorWithContext = nodeName ? `[${nodeName}] ${error}` : error;

  const updatedRecovery = {
    ...state.error_recovery,
    attempts: state.error_recovery.attempts + 1,
    lastError: error,
  };

  return {
    ...state,
    errors: [...state.errors, errorWithContext],
    error_recovery: updatedRecovery,
  };
};

export const canRetry = (
  state: GradingGraphState,
  maxRetries?: number,
): boolean => {
  const limit = maxRetries || state.context.maxRetries || 2;
  return state.retry_count < limit && state.error_recovery.attempts < limit * 2;
};

export const incrementRetry = (
  state: GradingGraphState,
): GradingGraphState => ({
  ...state,
  retry_count: state.retry_count + 1,
  error_recovery: {
    ...state.error_recovery,
    attempts: state.error_recovery.attempts + 1,
  },
});

export const getProcessingDuration = (state: GradingGraphState): number => {
  return Date.now() - state.processing_start_time;
};

export const isTimeoutExceeded = (state: GradingGraphState): boolean => {
  return getProcessingDuration(state) > state.max_processing_time;
};

export const recordNodeExecution = (
  state: GradingGraphState,
  nodeName: string,
  executionTime: number,
): GradingGraphState => ({
  ...state,
  processing_metrics: {
    ...state.processing_metrics,
    nodeExecutionTimes: {
      ...state.processing_metrics.nodeExecutionTimes,
      [nodeName]: executionTime,
    },
  },
});

export const updateCircuitBreaker = (
  state: GradingGraphState,
  nodeName: string,
  success: boolean,
): GradingGraphState => {
  const currentBreaker = state.node_circuit_breakers[nodeName] || {
    failures: 0,
    isOpen: false,
    resetTimeout: 60_000,
  };

  const updatedBreaker = success
    ? {
        ...currentBreaker,
        failures: Math.max(0, currentBreaker.failures - 1),
      }
    : {
        ...currentBreaker,
        failures: currentBreaker.failures + 1,
        lastFailure: Date.now(),
        isOpen: currentBreaker.failures >= 2,
      };

  return {
    ...state,
    node_circuit_breakers: {
      ...state.node_circuit_breakers,
      [nodeName]: updatedBreaker,
    },
  };
};

export const isNodeCircuitBreakerOpen = (
  state: GradingGraphState,
  nodeName: string,
): boolean => {
  const breaker = state.node_circuit_breakers[nodeName];
  if (!breaker || !breaker.isOpen) return false;

  const now = Date.now();
  if (breaker.lastFailure && now - breaker.lastFailure > breaker.resetTimeout) {
    return false;
  }

  return true;
};

export const shouldAbortProcessing = (state: GradingGraphState): boolean => {
  return (
    isTimeoutExceeded(state) ||
    state.errors.length > 10 ||
    state.error_recovery.attempts > 10 ||
    state.error_recovery.recoveryStrategy === "abort"
  );
};

export const determineFallbackStrategy = (
  state: GradingGraphState,
  nodeName: string,
): "retry" | "fallback" | "skip" | "abort" => {
  if (shouldAbortProcessing(state)) return "abort";

  if (isTimeoutExceeded(state)) return "fallback";

  if (isNodeCircuitBreakerOpen(state, nodeName)) return "skip";

  if (canRetry(state)) return "retry";

  return "fallback";
};

export const shouldRunJudgeA = (
  state: GradingGraphState,
  confidenceThreshold = 0.7,
): boolean => {
  if (!state.graderResult) return false;

  const lowConfidence = state.graderResult.confidence < confidenceThreshold;
  const hasEvidenceIssues =
    state.evidenceVerification &&
    state.evidenceVerification.invalidCriteriaIds.length > 0;

  return lowConfidence || !!hasEvidenceIssues;
};

export const shouldRunJudgeB = (
  state: GradingGraphState,
  totalThreshold = 2,
): boolean => {
  if (!state.graderResult || !state.judgeAResult) return false;

  const totalDelta = Math.abs(
    state.graderResult.totalAwarded - state.judgeAResult.totalAwarded,
  );

  return totalDelta > totalThreshold;
};

export const shouldRunTiebreak = (
  state: GradingGraphState,
  totalThreshold = 2,
  agreementThreshold = 0.6,
): boolean => {
  if (!state.comparison) return false;

  const highTotalDelta =
    state.comparison.graderVsJudgeA.totalDelta > totalThreshold;
  const lowAgreement =
    state.comparison.graderVsJudgeA.agreementPct < agreementThreshold;

  if (state.comparison.judgeAVsJudgeB) {
    const judgeDelta =
      state.comparison.judgeAVsJudgeB.totalDelta > totalThreshold;
    const judgeAgreement =
      state.comparison.judgeAVsJudgeB.agreementPct < agreementThreshold;
    return highTotalDelta || lowAgreement || judgeDelta || judgeAgreement;
  }

  return highTotalDelta || lowAgreement;
};
