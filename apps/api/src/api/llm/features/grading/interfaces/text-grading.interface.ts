import { TextBasedQuestionEvaluateModel } from "src/api/llm/model/text.based.question.evaluate.model";
import { TextBasedQuestionResponseModel } from "src/api/llm/model/text.based.question.response.model";

export interface ITextGradingService {
  /**
   * Grade a text-based question response
   */
  gradeTextBasedQuestion(
    model: TextBasedQuestionEvaluateModel,
    assignmentId: number,
    language?: string,
  ): Promise<TextBasedQuestionResponseModel>;
}
