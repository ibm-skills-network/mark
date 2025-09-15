/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from "@nestjs/common";
import { GradingGraphState } from "../graph/state";
import { GradeSchema } from "../schemas/zod-schemas";
import { GradeData, TiebreakResultData } from "../types/grading.types";

interface LLMThirdJudgeService {
  judgeGrading(context: {
    questionId: string;
    learnerAnswer: string;
    rubric: Array<{
      id: string;
      description: string;
      maxPoints: number;
    }>;
  }): Promise<any>;
}

interface MetaDeciderService {
  decide(features: {
    deltaA: number;
    deltaB: number;
    agreementPct: number;
    evidenceDensity: number;
  }): Promise<"accept_grader" | "accept_judges" | "tiebreak">;
}

@Injectable()
export class TiebreakNode {
  constructor(
    private llmThirdJudgeService: LLMThirdJudgeService,
    private metaDeciderService: MetaDeciderService,
  ) {}

  async execute(state: GradingGraphState): Promise<GradingGraphState> {
    if (!state.comparison || !state.graderResult || !state.judgeAResult) {
      return {
        ...state,
        errors: [...state.errors, "Insufficient data for tiebreak"],
        currentStep: "decision",
        shouldContinue: true,
      };
    }

    try {
      const tiebreakResult = await this.performTiebreak(state);

      return {
        ...state,
        tiebreakResult,
        currentStep: "decision",
        shouldContinue: true,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown tiebreak error";

      return {
        ...state,
        errors: [...state.errors, `Tiebreak failed: ${errorMessage}`],
        tiebreakResult: {
          method: "meta_decider",
          metaDecision: "accept_grader",
          confidence: 0.5,
        },
        currentStep: "decision",
        shouldContinue: true,
      };
    }
  }

  private async performTiebreak(
    state: GradingGraphState,
  ): Promise<TiebreakResultData> {
    const features = this.extractFeatures(state);

    const useMetaDecider = Math.random() > 0.5;

    if (useMetaDecider) {
      const metaDecision = await this.metaDeciderService.decide(features);

      return {
        method: "meta_decider",
        metaDecision,
        confidence: 0.8,
      };
    }

    const thirdJudgeResult = await this.llmThirdJudgeService.judgeGrading({
      questionId: state.context.questionId,
      learnerAnswer: state.context.learnerAnswer,
      rubric: state.context.rubric,
    });

    const parsed = GradeSchema.parse(thirdJudgeResult);

    return {
      method: "third_judge",
      result: parsed as GradeData,
      confidence: (parsed as GradeData).confidence,
    };
  }

  private extractFeatures(state: GradingGraphState) {
    const comparison = state.comparison;

    const evidenceCriteriaCount = state.graderResult.criteriaAwards.filter(
      (award) => award.evidence && award.evidence.length > 0,
    ).length;

    const evidenceDensity =
      evidenceCriteriaCount / state.graderResult.criteriaAwards.length;

    return {
      deltaA: comparison.graderVsJudgeA.totalDelta,
      deltaB: comparison.judgeAVsJudgeB?.totalDelta ?? 0,
      agreementPct: comparison.graderVsJudgeA.agreementPct,
      evidenceDensity,
    };
  }
}
