import { ApiProperty } from "@nestjs/swagger";

export class GeneralFeedbackDto {
  @ApiProperty({
    description: "The feedback earned by the leanrer.",
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

export class TrueFalseBasedFeedbackDto {
  @ApiProperty({
    description: "The choice selected by the learner (true or false).",
    type: Boolean,
    required: true,
  })
  choice: boolean;

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
      GeneralFeedbackDto,
      TrueFalseBasedFeedbackDto,
    ],
    isArray: true,
    required: true,
  })
  feedback:
    | ChoiceBasedFeedbackDto[]
    | GeneralFeedbackDto[]
    | TrueFalseBasedFeedbackDto[];
}
