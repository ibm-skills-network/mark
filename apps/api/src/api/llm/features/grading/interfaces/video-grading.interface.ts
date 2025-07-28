import { VideoPresentationQuestionEvaluateModel } from "src/api/llm/model/video-presentation.question.evaluate.model";
import { VideoPresentationQuestionResponseModel } from "src/api/llm/model/video-presentation.question.response.model";

export interface IVideoPresentationGradingService {
  /**
   * Grade a video presentation question response
   */
  gradeVideoPresentationQuestion(
    model: VideoPresentationQuestionEvaluateModel,
    assignmentId: number,
  ): Promise<VideoPresentationQuestionResponseModel>;
}
