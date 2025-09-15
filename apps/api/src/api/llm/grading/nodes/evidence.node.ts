import { Injectable } from "@nestjs/common";
import { GradingGraphState } from "../graph/state";
import { EvidenceService } from "../services/evidence.service";

@Injectable()
export class EvidenceNode {
  constructor(private evidenceService: EvidenceService) {}

  async execute(state: GradingGraphState): Promise<GradingGraphState> {
    if (!state.graderResult) {
      return {
        ...state,
        errors: [...state.errors, "No grader result for evidence verification"],
        shouldContinue: false,
        currentStep: "error",
      };
    }

    try {
      const evidenceVerification = await this.evidenceService.verifyEvidence(
        state.context.learnerAnswer,
        state.graderResult,
      );

      let updatedGraderResult = state.graderResult;

      if (
        !evidenceVerification.ok &&
        evidenceVerification.invalidCriteriaIds.length > 0
      ) {
        updatedGraderResult = this.evidenceService.zeroOutInvalidCriteria(
          state.graderResult,
          evidenceVerification.invalidCriteriaIds,
        );
      }

      return {
        ...state,
        graderResult: updatedGraderResult,
        evidenceVerification,
        currentStep: "judge_check",
        shouldContinue: true,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown evidence verification error";

      return {
        ...state,
        errors: [
          ...state.errors,
          `Evidence verification failed: ${errorMessage}`,
        ],
        evidenceVerification: {
          ok: false,
          invalidCriteriaIds: [],
          details: [],
        },
        currentStep: "judge_check",
        shouldContinue: true,
      };
    }
  }
}
