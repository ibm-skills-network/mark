import { ApiProperty } from "@nestjs/swagger";
import { BaseAssignmentAttemptResponseDto } from "./base.assignment.attempt.response.dto";

export class UpdateAssignmentAttemptResponseDto extends BaseAssignmentAttemptResponseDto {
  @ApiProperty({
    description: "Represents if the learner has submitted this or not.",
    type: Boolean,
    example: false,
    required: true,
  })
  submitted: boolean;

  @ApiProperty({
    description:
      "The overall LTI grade value (from 0.0 - 1.0) that the learner earned for this attempt.",
    type: Number,
    example: 0.8,
    required: false,
  })
  grade: number | null;
}
