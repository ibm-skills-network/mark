import { Injectable } from "@nestjs/common";

export interface MetaDecisionFeatures {
  deltaA: number;
  deltaB: number;
  agreementPct: number;
  evidenceDensity: number;
}

export type MetaDecision = "accept_grader" | "accept_judges" | "tiebreak";

@Injectable()
export class MetaDeciderService {
  async decide(features: MetaDecisionFeatures): Promise<MetaDecision> {
    const decisionScore = this.calculateDecisionScore(features);

    if (decisionScore < -0.3) {
      return "accept_grader";
    } else if (decisionScore > 0.3) {
      return "accept_judges";
    } else {
      return "tiebreak";
    }
  }

  private calculateDecisionScore(features: MetaDecisionFeatures): number {
    let score = 0;

    score += this.deltaAContribution(features.deltaA);
    score += this.deltaBContribution(features.deltaB);
    score += this.agreementContribution(features.agreementPct);
    score += this.evidenceContribution(features.evidenceDensity);

    return Math.max(-1, Math.min(1, score));
  }

  private deltaAContribution(deltaA: number): number {
    if (deltaA <= 1) return -0.4;
    if (deltaA <= 2) return -0.1;
    if (deltaA <= 3) return 0.2;
    return 0.4;
  }

  private deltaBContribution(deltaB: number): number {
    if (deltaB === 0) return 0;
    if (deltaB <= 1) return 0.3;
    if (deltaB <= 2) return 0.1;
    return -0.2;
  }

  private agreementContribution(agreementPct: number): number {
    if (agreementPct >= 0.8) return -0.3;
    if (agreementPct >= 0.6) return -0.1;
    if (agreementPct >= 0.4) return 0.1;
    return 0.3;
  }

  private evidenceContribution(evidenceDensity: number): number {
    if (evidenceDensity >= 0.8) return -0.2;
    if (evidenceDensity >= 0.5) return -0.1;
    if (evidenceDensity >= 0.2) return 0.1;
    return 0.2;
  }

  async loadONNXModel(): Promise<void> {
    throw new Error("ONNX model loading not implemented yet");
  }

  async predictWithONNX(): Promise<MetaDecision> {
    throw new Error("ONNX prediction not implemented yet");
  }
}
