import { PresentationQuestionEvaluateModel } from "src/api/llm/model/presentation.question.evaluate.model";
import { PresentationQuestionResponseModel } from "src/api/llm/model/presentation.question.response.model";
import { LearnerLiveRecordingFeedback } from "../../../../assignment/attempt/dto/assignment-attempt/types";

export interface IPresentationGradingService {
  /**
   * Grade a presentation question response
   */
  gradePresentationQuestion(
    model: PresentationQuestionEvaluateModel,
    assignmentId: number,
  ): Promise<PresentationQuestionResponseModel>;

  /**
   * Generate feedback for a live recording
   */
  getLiveRecordingFeedback(
    liveRecordingData: LearnerLiveRecordingFeedback,
    assignmentId: number,
  ): Promise<string>;
}
