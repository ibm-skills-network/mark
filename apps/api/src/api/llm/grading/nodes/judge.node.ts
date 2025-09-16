/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from "@nestjs/common";
import { GradingGraphState } from "../graph/state";
import { GradeSchema } from "../schemas/zod-schemas";
import { GradeData } from "../types/grading.types";

interface LLMJudgeService {
  judgeGrading(context: {
    questionId: string;
    learnerAnswer: string;
    rubric: Array<{
      id: string;
      description: string;
      maxPoints: number;
    }>;
    specificCriteria?: string[];
  }): Promise<any>;
}

@Injectable()
export class JudgeNode {
  constructor(private llmJudgeService: LLMJudgeService) {}

  async executeJudgeA(state: GradingGraphState): Promise<GradingGraphState> {
    return this.executeJudge(state, "judgeA");
  }

  async executeJudgeB(state: GradingGraphState): Promise<GradingGraphState> {
    const differingCriteria = this.getDifferingCriteria(state);
    return this.executeJudge(state, "judgeB", differingCriteria);
  }

  private async executeJudge(
    state: GradingGraphState,
    judgeName: "judgeA" | "judgeB",
    specificCriteria?: string[],
  ): Promise<GradingGraphState> {
    try {
      const result = await this.llmJudgeService.judgeGrading({
        questionId: state.context.questionId,
        learnerAnswer: state.context.learnerAnswer,
        rubric: specificCriteria
          ? state.context.rubric.filter((r) => specificCriteria.includes(r.id))
          : state.context.rubric,
        specificCriteria,
      });

      const parsed = GradeSchema.parse(result);

      return judgeName === "judgeA"
        ? {
            ...state,
            judgeAResult: parsed as GradeData,
            currentStep: "judgeB_check",
            shouldContinue: true,
          }
        : {
            ...state,
            judgeBResult: specificCriteria
              ? this.mergePartialGrade(
                  state,
                  parsed as GradeData,
                  specificCriteria,
                )
              : (parsed as GradeData),
            currentStep: "compare",
            shouldContinue: true,
          };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : `Unknown ${judgeName} error`;

      return {
        ...state,
        errors: [...state.errors, `${judgeName} failed: ${errorMessage}`],
        currentStep: "compare",
        shouldContinue: true,
      };
    }
  }

  private getDifferingCriteria(state: GradingGraphState): string[] {
    if (!state.graderResult || !state.judgeAResult) {
      return [];
    }

    const differingCriteria: string[] = [];

    for (const graderAward of state.graderResult.criteriaAwards) {
      const judgeAward = state.judgeAResult.criteriaAwards.find(
        (a) => a.criterionId === graderAward.criterionId,
      );

      if (
        judgeAward &&
        Math.abs(graderAward.awarded - judgeAward.awarded) > 1
      ) {
        differingCriteria.push(graderAward.criterionId);
      }
    }

    return differingCriteria;
  }

  private mergePartialGrade(
    state: GradingGraphState,
    partialGrade: {
      criteriaAwards: Array<{ criterionId: string; awarded: number }>;
      totalAwarded: number;
      overallFeedback: string;
      confidence: number;
    },
    updatedCriteria: string[],
  ): any {
    if (!state.judgeAResult) {
      return partialGrade;
    }

    const mergedAwards = state.judgeAResult.criteriaAwards.map((award) => {
      if (updatedCriteria.includes(award.criterionId)) {
        const updatedAward = partialGrade.criteriaAwards.find(
          (a: { criterionId: string; awarded: number; evidence?: string[] }) =>
            a.criterionId === award.criterionId,
        );
        return updatedAward || award;
      }
      return award;
    });

    const totalAwarded = mergedAwards.reduce(
      (sum, award) => sum + award.awarded,
      0,
    );

    return {
      ...state.judgeAResult,
      criteriaAwards: mergedAwards,
      totalAwarded,
      overallFeedback: `${
        state.judgeAResult.overallFeedback
      } [Updated: ${updatedCriteria.join(", ")}]`,
    };
  }

  private createJudgePrompt(
    context: GradingGraphState["context"],
    specificCriteria?: string[],
  ): string {
    const targetRubric = specificCriteria
      ? context.rubric.filter((r) => specificCriteria.includes(r.id))
      : context.rubric;

    const criteriaList = targetRubric
      .map((c) => `${c.id}: ${c.description} (${c.maxPoints}pts)`)
      .join("\n");

    const instruction = specificCriteria
      ? `Re-grade ONLY these specific criteria: ${specificCriteria.join(", ")}`
      : "Grade this answer independently";

    return `${instruction}

ANSWER: "${context.learnerAnswer}"

CRITERIA:
${criteriaList}

Provide independent scoring without seeing previous grades.

Return JSON:
{
  "criteriaAwards": [...],
  "totalAwarded": N,
  "totalMax": ${targetRubric.reduce((sum, c) => sum + c.maxPoints, 0)},
  "overallFeedback": "brief assessment",
  "confidence": 0.0-1.0
}`;
  }
}
