import { TextBasedQuestionResponseModel } from "../../../llm/model/text.based.question.response.model";
import { TextBasedFeedbackDto } from "../../submission/dto/question-response/create.question.response.submission.response.dto";

// Create a new class
export const GradingHelper = {
  // Converts TextBasedQuestionResponseModel to TextBasedFeedbackDto
  toTextBasedFeedbackDto(
    model: TextBasedQuestionResponseModel
  ): TextBasedFeedbackDto {
    const dto = new TextBasedFeedbackDto();
    dto.criteria = model.criteria;
    dto.points = model.points;
    dto.feedback = model.feedback;
    return dto;
  },
};
