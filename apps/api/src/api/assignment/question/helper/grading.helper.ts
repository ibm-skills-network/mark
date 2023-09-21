import { TextBasedQuestionResponseModel } from "../../../llm/model/text.based.question.response.model";
import { TextBasedFeedbackDto } from "../../attempt/dto/question-response/create.question.response.attempt.response.dto";

// Create a new class
export const GradingHelper = {
  // Converts TextBasedQuestionResponseModel to TextBasedFeedbackDto
  toTextBasedFeedbackDto(
    model: TextBasedQuestionResponseModel
  ): TextBasedFeedbackDto {
    const dto = new TextBasedFeedbackDto();
    dto.points = model.points;
    dto.feedback = model.feedback;
    return dto;
  },
};
