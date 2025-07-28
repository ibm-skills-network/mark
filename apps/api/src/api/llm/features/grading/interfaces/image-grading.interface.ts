import { ImageBasedQuestionEvaluateModel } from "src/api/llm/model/image.based.evalutate.model";
import { ImageBasedQuestionResponseModel } from "src/api/llm/model/image.based.response.model";

export interface IImageGradingService {
  /**
   * Grade an image-based question response
   */
  gradeImageBasedQuestion(
    model: ImageBasedQuestionEvaluateModel,
    assignmentId: number,
  ): Promise<ImageBasedQuestionResponseModel>;
}
