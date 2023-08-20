import { ApiProperty } from "@nestjs/swagger";
import { BaseAssignmentSubmissionResponseDto } from "./base.assignment.submission.response.dto";

export class UpdateAssignmentSubmissionResponseDto extends BaseAssignmentSubmissionResponseDto {
  @ApiProperty({
    description: "Represents if the learner has submitted this or not.",
    type: Boolean,
    example: false,
    required: true,
  })
  submitted: boolean;

  @ApiProperty({
    description:
      "The overall LTI grade value (from 0.0 - 1.0) that the learner earned for this submission.",
    type: Number,
    example: 0.8,
    required: false,
  })
  grade: number | null;
}
