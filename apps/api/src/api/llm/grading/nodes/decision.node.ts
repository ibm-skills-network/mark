import { Injectable } from "@nestjs/common";
import { GradingGraphState } from "../graph/state";
import {
  FinalGradeData,
  GradeData,
  ValidatedGradeData,
} from "../types/grading.types";

interface PolicyService {
  decide(
    graderResult: any,
    judgeAResult?: any,
    judgeBResult?: any,
    comparison?: any,
    tiebreakResult?: any,
  ): {
    selectedSource: "grader" | "judges" | "tiebreak";
    reasoning: string;
  };
}

@Injectable()
export class DecisionNode {
  constructor(private policyService: PolicyService) {}

  async execute(state: GradingGraphState): Promise<GradingGraphState> {
    if (!state.graderResult) {
      return {
        ...state,
        errors: [...state.errors, "No grader result for final decision"],
        shouldContinue: false,
        currentStep: "error",
      };
    }

    try {
      const decision = this.policyService.decide(
        state.graderResult,
        state.judgeAResult,
        state.judgeBResult,
        state.comparison,
        state.tiebreakResult,
      );

      const selectedGrade = this.selectGrade(state, decision.selectedSource);
      const processingSteps = this.determineProcessingSteps(state);
      const metadata = this.buildMetadata(state);

      const finalGrade: FinalGradeData = {
        selectedSource: decision.selectedSource,
        grade: selectedGrade,
        reasoning: decision.reasoning,
        processingSteps,
        metadata,
      };

      return {
        ...state,
        finalGrade,
        currentStep: "completed",
        shouldContinue: false,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown decision error";

      return {
        ...state,
        errors: [...state.errors, `Final decision failed: ${errorMessage}`],
        shouldContinue: false,
        currentStep: "error",
      };
    }
  }

  private selectGrade(
    state: GradingGraphState,
    selectedSource: "grader" | "judges" | "tiebreak",
  ): ValidatedGradeData | GradeData | undefined {
    switch (selectedSource) {
      case "grader": {
        return state.graderResult;
      }

      case "judges": {
        return state.judgeAResult || state.graderResult;
      }

      case "tiebreak": {
        if (state.tiebreakResult?.result) {
          return state.tiebreakResult.result;
        }
        if (state.tiebreakResult?.metaDecision === "accept_grader") {
          return state.graderResult;
        }
        if (state.tiebreakResult?.metaDecision === "accept_judges") {
          return state.judgeAResult || state.graderResult;
        }
        return state.graderResult;
      }

      default: {
        return state.graderResult;
      }
    }
  }

  private determineProcessingSteps(
    state: GradingGraphState,
  ): Array<
    | "grade"
    | "validate"
    | "judgeA"
    | "judgeB"
    | "evidence"
    | "compare"
    | "tiebreak"
    | "decision"
  > {
    const steps: Array<
      | "grade"
      | "validate"
      | "judgeA"
      | "judgeB"
      | "evidence"
      | "compare"
      | "tiebreak"
      | "decision"
    > = ["grade", "validate", "evidence"];

    if (state.judgeAResult) steps.push("judgeA");
    if (state.judgeBResult) steps.push("judgeB");
    if (state.comparison) steps.push("compare");
    if (state.tiebreakResult) steps.push("tiebreak");

    steps.push("decision");

    return steps;
  }

  private buildMetadata(state: GradingGraphState) {
    const totalProcessingTimeMs = Date.now() - state.processing_start_time;

    let llmCalls = 1;
    if (state.judgeAResult) llmCalls++;
    if (state.judgeBResult) llmCalls++;
    if (state.tiebreakResult?.method === "third_judge") llmCalls++;

    let earlyExitReason: string | undefined;
    if (!state.judgeAResult) {
      earlyExitReason = "High confidence grader result with valid evidence";
    } else if (!state.judgeBResult) {
      earlyExitReason = "Judge A agreed with grader within thresholds";
    }

    return {
      totalProcessingTimeMs,
      llmCalls,
      earlyExitReason,
    };
  }
}
