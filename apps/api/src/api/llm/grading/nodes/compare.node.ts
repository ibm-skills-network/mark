import { Injectable } from "@nestjs/common";
import { GradingGraphState } from "../graph/state";
import {
  CriterionAwardData,
  GradeData,
  JudgeComparisonData,
  ValidatedGradeData,
} from "../types/grading.types";

@Injectable()
export class CompareNode {
  async execute(state: GradingGraphState): Promise<GradingGraphState> {
    if (!state.graderResult || !state.judgeAResult) {
      return {
        ...state,
        errors: [
          ...state.errors,
          "Missing grader or judge results for comparison",
        ],
        currentStep: "decision",
        shouldContinue: true,
      };
    }

    try {
      const comparison = this.computeComparison(state);

      return {
        ...state,
        comparison,
        currentStep: "tiebreak_check",
        shouldContinue: true,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown comparison error";

      return {
        ...state,
        errors: [...state.errors, `Comparison failed: ${errorMessage}`],
        currentStep: "decision",
        shouldContinue: true,
      };
    }
  }

  private computeComparison(state: GradingGraphState): JudgeComparisonData {
    const graderVsJudgeA = this.compareGrades(
      state.graderResult,
      state.judgeAResult,
    );

    const judgeAVsJudgeB = state.judgeBResult
      ? this.compareGrades(state.judgeAResult, state.judgeBResult)
      : undefined;

    return {
      graderVsJudgeA,
      judgeAVsJudgeB,
    };
  }

  private compareGrades(
    grade1: ValidatedGradeData | GradeData,
    grade2: GradeData,
  ): {
    totalDelta: number;
    criterionDeltas: Array<{ criterionId: string; delta: number }>;
    agreementPct: number;
  } {
    const totalDelta = Math.abs(
      (grade1.totalAwarded ?? 0) - (grade2.totalAwarded ?? 0),
    );

    const criterionDeltas = (grade1.criteriaAwards ?? []).map(
      (award1: CriterionAwardData) => {
        const award2 = (grade2.criteriaAwards ?? []).find(
          (award: CriterionAwardData) =>
            award.criterionId === award1.criterionId,
        );
        const delta = award2
          ? Math.abs((award1.awarded ?? 0) - (award2.awarded ?? 0))
          : (award1.awarded ?? 0);

        return {
          criterionId: award1.criterionId ?? "",
          delta,
        };
      },
    );

    const agreementCount = criterionDeltas.filter((cd) => cd.delta <= 1).length;
    const agreementPct =
      criterionDeltas.length > 0 ? agreementCount / criterionDeltas.length : 0;

    return {
      totalDelta,
      criterionDeltas,
      agreementPct,
    };
  }
}
