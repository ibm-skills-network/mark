import { ApiProperty } from "@nestjs/swagger";
import { TrueFalseChoiceBasedFeedback } from "../../../../..//api/llm/model/true.false.based.question.response.model";

export class TextBasedFeedbackDto {
  @ApiProperty({
    description: "The points earned for the above criteria.",
    type: Number,
    required: true,
  })
  points: number;

  @ApiProperty({
    description: "The feedback earned for the above criteria.",
    type: String,
    required: true,
  })
  feedback: string;
}

export class ChoiceBasedFeedbackDto {
  @ApiProperty({
    description: "The choice selected by the learner.",
    type: String,
    required: true,
  })
  choice: string;

  @ApiProperty({
    description: "The feedback for selecting the above choice.",
    type: String,
    required: true,
  })
  feedback: string;
}

export class CreateQuestionResponseAttemptResponseDto {
  @ApiProperty({
    description: "The unqiue id of the question response.",
    type: Number,
    required: true,
  })
  id: number;

  @ApiProperty({
    description: "The total points earned.",
    type: Number,
    required: true,
  })
  totalPoints: number;

  @ApiProperty({
    description:
      "The feedback received after evaluating the question response of the learner.",
    type: [
      ChoiceBasedFeedbackDto,
      TextBasedFeedbackDto,
      TrueFalseChoiceBasedFeedback,
    ],
    isArray: true,
    required: true,
  })
  feedback:
    | ChoiceBasedFeedbackDto[]
    | TextBasedFeedbackDto[]
    | TrueFalseChoiceBasedFeedback[];
}
