/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from "@nestjs/common";
import { GradingGraphState } from "../graph/state";
import { GradeSchema } from "../schemas/zod-schemas";
import { GradeData, ValidatedGradeData } from "../types/grading.types";

interface LLMGradingService {
  gradeWithRubric(context: {
    questionId: string;
    learnerAnswer: string;
    rubric: Array<{
      id: string;
      description: string;
      maxPoints: number;
      keywords?: string[];
    }>;
    questionType: string;
    responseType?: string;
  }): Promise<any>;
}

@Injectable()
export class GradeNode {
  constructor(private llmGradingService: LLMGradingService) {}

  async execute(state: GradingGraphState): Promise<GradingGraphState> {
    try {
      const result = await this.llmGradingService.gradeWithRubric({
        questionId: state.context.questionId,
        learnerAnswer: state.context.learnerAnswer,
        rubric: state.context.rubric,
        questionType: state.context.questionType,
        responseType: state.context.responseType,
      });

      const parsed = GradeSchema.parse(result);

      return {
        ...state,
        graderResult: {
          ...(parsed as GradeData),
          isValid: true,
          validationErrors: [],
          arithmeticFixed: false,
        } as ValidatedGradeData,
        currentStep: "validate",
        shouldContinue: true,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown grading error";

      return {
        ...state,
        errors: [...state.errors, `Grading failed: ${errorMessage}`],
        shouldContinue: false,
        currentStep: "error",
      };
    }
  }
}
