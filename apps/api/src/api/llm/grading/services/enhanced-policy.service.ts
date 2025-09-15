import { Injectable, Logger } from "@nestjs/common";
import {
  createDynamicThresholds,
  DEFAULT_POLICY_CONFIG,
  getQuestionTypePolicy,
  GradingPolicyConfig,
} from "../config/policy.config";
import {
  DecisionContext,
  EvidenceVerificationData,
  GradeData,
  JudgeComparisonData,
  PolicyDecision,
  TiebreakResultData,
} from "../types/grading.types";

@Injectable()
export class EnhancedPolicyService {
  private readonly logger = new Logger(EnhancedPolicyService.name);
  private config: GradingPolicyConfig;

  constructor(config?: Partial<GradingPolicyConfig>) {
    this.config = {
      ...DEFAULT_POLICY_CONFIG,
      ...config,
    };
  }

  decide(
    graderResult: GradeData,
    judgeAResult?: GradeData,
    judgeBResult?: GradeData,
    comparison?: JudgeComparisonData,
    tiebreakResult?: TiebreakResultData,
    context?: DecisionContext,
  ): PolicyDecision {
    try {
      this.validateInputs(graderResult);

      if (tiebreakResult) {
        return this.decideTiebreak(
          tiebreakResult,
          graderResult,
          judgeAResult,
          context,
        );
      }

      if (!judgeAResult) {
        return this.decideEarlyExit(graderResult, context);
      }

      if (!judgeBResult) {
        return this.decideSingleJudge(
          graderResult,
          judgeAResult,
          comparison,
          context,
        );
      }

      return this.decideMultipleJudges(
        graderResult,
        judgeAResult,
        judgeBResult,
        comparison,
        context,
      );
    } catch (error) {
      this.logger.error("Policy decision failed:", error);
      return this.getFailsafeDecision(graderResult);
    }
  }

  shouldEarlyExit(
    graderResult: GradeData,
    evidenceVerification?: EvidenceVerificationData,
    questionType?: string,
    context?: DecisionContext,
  ): boolean {
    if (!this.config.earlyExit.ACCEPT_ON_HIGH_CONFIDENCE) {
      return false;
    }

    try {
      if (context?.fallbackUsed) {
        this.logger.warn("Fallback grading used, skipping early exit");
        return false;
      }

      if (context?.errorCount && context.errorCount > 0) {
        return false;
      }

      const questionPolicy = questionType
        ? getQuestionTypePolicy(questionType)
        : {};

      if (
        questionType === "TRUE_FALSE" &&
        questionPolicy.TRUE_FALSE_AUTO_ACCEPT
      ) {
        return (
          graderResult.confidence >= 0.5 && this.isReasonableScore(graderResult)
        );
      }

      if (
        ["SINGLE_CORRECT", "MULTIPLE_CORRECT"].includes(questionType || "") &&
        questionPolicy.MCQ_AUTO_ACCEPT
      ) {
        return (
          graderResult.confidence >= 0.6 && this.isReasonableScore(graderResult)
        );
      }

      const highConfidence =
        graderResult.confidence >= this.config.thresholds.CONFIDENCE_THRESHOLD;
      const validEvidence =
        !evidenceVerification ||
        evidenceVerification.ok ||
        this.hasMinimalEvidence(graderResult);
      const reasonableScore = this.isReasonableScore(graderResult);
      const noAnomalies = !this.detectScoringAnomalies(graderResult);

      return highConfidence && validEvidence && reasonableScore && noAnomalies;
    } catch (error) {
      this.logger.error("Early exit evaluation failed:", error);
      return false;
    }
  }

  private validateInputs(graderResult: GradeData): void {
    if (!graderResult) {
      throw new Error("Grader result is required");
    }

    if (
      !graderResult.criteriaAwards ||
      !Array.isArray(graderResult.criteriaAwards)
    ) {
      throw new Error("Invalid grader result structure");
    }

    if (
      typeof graderResult.totalAwarded !== "number" ||
      graderResult.totalAwarded < 0
    ) {
      throw new Error("Invalid total awarded score");
    }

    if (
      typeof graderResult.confidence !== "number" ||
      graderResult.confidence < 0 ||
      graderResult.confidence > 1
    ) {
      throw new Error("Invalid confidence value");
    }
  }

  private decideTiebreak(
    tiebreakResult: TiebreakResultData,
    graderResult: GradeData,
    judgeAResult?: GradeData,
    context?: DecisionContext,
  ): PolicyDecision {
    if (tiebreakResult.method === "third_judge" && tiebreakResult.result) {
      const confidence = Math.min(0.9, tiebreakResult.confidence || 0.7);
      return {
        selectedSource: "tiebreak",
        reasoning: `Third judge resolution with ${confidence.toFixed(
          2,
        )} confidence`,
        confidence,
        riskLevel: this.assessRiskLevel(confidence, context),
        fallbackUsed: context?.fallbackUsed || false,
      };
    }

    if (tiebreakResult.metaDecision === "accept_grader") {
      return {
        selectedSource: "grader",
        reasoning: "Meta-decider recommends original grader result",
        confidence: Math.min(0.8, graderResult.confidence),
        riskLevel: this.assessRiskLevel(graderResult.confidence, context),
        fallbackUsed: context?.fallbackUsed || false,
      };
    }

    if (tiebreakResult.metaDecision === "accept_judges") {
      const judgeConfidence = judgeAResult ? judgeAResult.confidence : 0.7;
      return {
        selectedSource: "judges",
        reasoning: "Meta-decider recommends judge consensus",
        confidence: Math.min(0.8, judgeConfidence),
        riskLevel: this.assessRiskLevel(judgeConfidence, context),
        fallbackUsed: context?.fallbackUsed || false,
      };
    }

    return {
      selectedSource: "grader",
      reasoning:
        "Tiebreak failed, defaulting to grader with reduced confidence",
      confidence: Math.min(0.5, graderResult.confidence),
      riskLevel: "high",
      fallbackUsed: context?.fallbackUsed || false,
    };
  }

  private decideEarlyExit(
    graderResult: GradeData,
    context?: DecisionContext,
  ): PolicyDecision {
    const confidence = context?.fallbackUsed
      ? Math.min(0.6, graderResult.confidence)
      : graderResult.confidence;

    return {
      selectedSource: "grader",
      reasoning: "Early exit: High confidence grader with valid evidence",
      confidence,
      riskLevel: this.assessRiskLevel(confidence, context),
      fallbackUsed: context?.fallbackUsed || false,
    };
  }

  private decideSingleJudge(
    graderResult: GradeData,
    judgeAResult: GradeData,
    comparison?: JudgeComparisonData,
    context?: DecisionContext,
  ): PolicyDecision {
    const thresholds = this.getThresholds(context?.totalMax);

    const withinThreshold =
      !comparison ||
      comparison.graderVsJudgeA.totalDelta <= thresholds.TAU_TOTAL;
    const goodAgreement =
      !comparison ||
      comparison.graderVsJudgeA.agreementPct >=
        this.config.thresholds.AGREEMENT_THRESHOLD;

    const graderReliable = !this.detectScoringAnomalies(graderResult);
    const judgeReliable = !this.detectScoringAnomalies(judgeAResult);

    if (withinThreshold && goodAgreement && graderReliable) {
      return {
        selectedSource: "grader",
        reasoning: "Grader and Judge A agree within thresholds",
        confidence: Math.min(
          graderResult.confidence,
          judgeAResult.confidence + 0.1,
        ),
        riskLevel: "low",
        fallbackUsed: context?.fallbackUsed || false,
      };
    }

    if (
      judgeReliable &&
      (!graderReliable || judgeAResult.confidence > graderResult.confidence)
    ) {
      return {
        selectedSource: "judges",
        reasoning: "Judge A shows higher reliability or confidence than grader",
        confidence: judgeAResult.confidence,
        riskLevel: this.assessRiskLevel(judgeAResult.confidence, context),
        fallbackUsed: context?.fallbackUsed || false,
      };
    }

    return {
      selectedSource: "grader",
      reasoning: "Preferring grader despite disagreement with Judge A",
      confidence: Math.min(0.7, graderResult.confidence),
      riskLevel: "medium",
      fallbackUsed: context?.fallbackUsed || false,
    };
  }

  private decideMultipleJudges(
    graderResult: GradeData,
    judgeAResult: GradeData,
    judgeBResult: GradeData,
    comparison?: JudgeComparisonData,
    context?: DecisionContext,
  ): PolicyDecision {
    const thresholds = this.getThresholds(context?.totalMax);

    if (!comparison) {
      return {
        selectedSource: "judges",
        reasoning: "No comparison data, averaging judge results",
        confidence: Math.min(judgeAResult.confidence, judgeBResult.confidence),
        riskLevel: "medium",
        fallbackUsed: context?.fallbackUsed || false,
      };
    }

    const graderJudgeADelta = comparison.graderVsJudgeA.totalDelta;
    const judgeABDelta = comparison.judgeAVsJudgeB?.totalDelta ?? 0;

    const allAgree =
      graderJudgeADelta <= thresholds.TAU_TOTAL &&
      judgeABDelta <= thresholds.TAU_TOTAL;

    if (allAgree) {
      const avgConfidence =
        (graderResult.confidence +
          judgeAResult.confidence +
          judgeBResult.confidence) /
        3;
      return {
        selectedSource: "grader",
        reasoning:
          "All sources agree within thresholds, keeping original grader result",
        confidence: avgConfidence,
        riskLevel: "low",
        fallbackUsed: context?.fallbackUsed || false,
      };
    }

    const judgesAgree = judgeABDelta <= thresholds.TAU_TOTAL;
    if (judgesAgree) {
      const judgeConfidence =
        (judgeAResult.confidence + judgeBResult.confidence) / 2;
      return {
        selectedSource: "judges",
        reasoning: "Judges agree with each other but disagree with grader",
        confidence: judgeConfidence,
        riskLevel: this.assessRiskLevel(judgeConfidence, context),
        fallbackUsed: context?.fallbackUsed || false,
      };
    }

    const graderMostReliable =
      !this.detectScoringAnomalies(graderResult) &&
      graderResult.confidence >=
        Math.max(judgeAResult.confidence, judgeBResult.confidence);

    if (graderMostReliable) {
      return {
        selectedSource: "grader",
        reasoning:
          "Grader shows highest reliability among conflicting assessments",
        confidence: Math.min(0.7, graderResult.confidence),
        riskLevel: "medium",
        fallbackUsed: context?.fallbackUsed || false,
      };
    }

    return {
      selectedSource: "judges",
      reasoning:
        "Complex disagreement, averaging judge results as safest option",
      confidence: Math.min(
        0.6,
        (judgeAResult.confidence + judgeBResult.confidence) / 2,
      ),
      riskLevel: "high",
      fallbackUsed: context?.fallbackUsed || false,
    };
  }

  private getFailsafeDecision(graderResult: GradeData): PolicyDecision {
    this.logger.warn("Using failsafe decision due to policy evaluation error");

    return {
      selectedSource: "grader",
      reasoning: "Failsafe decision due to policy evaluation error",
      confidence: Math.min(0.4, graderResult?.confidence || 0.4),
      riskLevel: "high",
      fallbackUsed: true,
    };
  }

  private isReasonableScore(result: GradeData): boolean {
    if (result.totalAwarded > result.totalMax * 1.1) return false;
    if (result.totalAwarded < 0) return false;

    for (const award of result.criteriaAwards) {
      if (award.awarded > award.maxPoints * 1.1) return false;
      if (award.awarded < 0) return false;
    }

    return true;
  }

  private detectScoringAnomalies(result: GradeData): boolean {
    try {
      const variance = this.calculateScoreVariance(result);
      if (variance > result.totalMax * 0.5) return true;

      const extremeScores = result.criteriaAwards.filter(
        (award: { awarded: number; maxPoints: number }) =>
          award.awarded === 0 || award.awarded === award.maxPoints,
      ).length;

      const extremeRatio = extremeScores / result.criteriaAwards.length;
      if (extremeRatio > 0.8) return true;

      const hasImpossibleScores = result.criteriaAwards.some(
        (award: { awarded: number; maxPoints: number }) =>
          award.awarded > award.maxPoints || award.awarded < 0,
      );

      return hasImpossibleScores;
    } catch (error) {
      this.logger.warn("Anomaly detection failed:", error);
      return false;
    }
  }

  private calculateScoreVariance(result: GradeData): number {
    const ratios = result.criteriaAwards.map((award) =>
      award.maxPoints > 0 ? award.awarded / award.maxPoints : 0,
    );

    const mean = ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
    const variance =
      ratios.reduce((sum, ratio) => sum + Math.pow(ratio - mean, 2), 0) /
      ratios.length;

    return Math.sqrt(variance);
  }

  private hasMinimalEvidence(result: GradeData): boolean {
    const withEvidence = result.criteriaAwards.filter(
      (award) =>
        award.awarded > 0 && award.evidence && award.evidence.length > 10,
    ).length;

    const scoredCriteria = result.criteriaAwards.filter(
      (award) => award.awarded > 0,
    ).length;

    return scoredCriteria === 0 || withEvidence / scoredCriteria >= 0.3;
  }

  private assessRiskLevel(
    confidence: number,
    context?: DecisionContext,
  ): "low" | "medium" | "high" {
    if (
      context?.fallbackUsed ||
      (context?.errorCount && context.errorCount > 2)
    ) {
      return "high";
    }

    if (confidence >= 0.8) return "low";
    if (confidence >= 0.6) return "medium";
    return "high";
  }

  private getThresholds(totalMax?: number) {
    return totalMax
      ? createDynamicThresholds(totalMax)
      : this.config.thresholds;
  }

  updateConfig(newConfig: Partial<GradingPolicyConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logger.log("Policy configuration updated");
  }

  getConfig(): GradingPolicyConfig {
    return { ...this.config };
  }
}
