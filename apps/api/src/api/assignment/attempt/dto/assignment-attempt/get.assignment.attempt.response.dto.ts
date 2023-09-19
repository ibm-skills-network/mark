import { ApiProperty } from "@nestjs/swagger";
import { QuestionResponse } from "@prisma/client";

export class AssignmentAttemptResponseDto {
  @ApiProperty({
    description: "The unique ID of the AssignmentAttempt",
    type: Number,
    example: 1,
  })
  id: number;

  @ApiProperty({
    description: "The ID of the assignment that this attempt corresponds to",
    type: Number,
    example: 2,
  })
  assignmentId: number;

  @ApiProperty({
    description: "Represents if the learner has submitted this or not",
    type: Boolean,
    example: false,
  })
  submitted: boolean;

  @ApiProperty({
    description:
      "The overall LTI grade value (from 0.0 - 1.0) that the learner earned for this attempt",
    type: Number,
    example: 0.8,
    required: false,
  })
  grade: number | null;

  @ApiProperty({
    description:
      "The DateTime at which the attempt window ends (can no longer submit it)",
    type: Date,
    example: "2023-12-31T23:59:59Z",
    required: false,
  })
  expiresAt: Date | null;
}

export class GetAssignmentAttemptResponseDto extends AssignmentAttemptResponseDto {
  @ApiProperty({
    description:
      "The list of responses provided by the learner for each of the questions in the assignment",
    isArray: true,
  })
  questionResponses: QuestionResponse[];
}
