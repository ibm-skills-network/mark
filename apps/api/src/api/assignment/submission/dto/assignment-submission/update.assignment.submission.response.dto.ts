import { ApiProperty } from "@nestjs/swagger";
import { BaseResponseDto } from "../base.response.dto";

export class UpdateAssignmentSubmissionResponseDto extends BaseResponseDto {
  @ApiProperty({
    description: "The unique ID of the AssignmentSubmission",
    type: Number,
    example: 1,
  })
  id: number;

  @ApiProperty({
    description: "Represents if the learner has submitted this or not",
    type: Boolean,
    example: false,
  })
  submitted: boolean;

  @ApiProperty({
    description:
      "The overall LTI grade value (from 0.0 - 1.0) that the learner earned for this submission",
    type: Number,
    example: 0.8,
    required: false,
  })
  grade: number | null;
}
