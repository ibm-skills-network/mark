import { ApiProperty } from "@nestjs/swagger";
import { AssignmentSubmissionState, QuestionResponse } from "@prisma/client";
import { BaseResponseDto } from "../base.response.dto";

export class GetAssignmentSubmissionResponseDto extends BaseResponseDto {
  @ApiProperty({
    description: "The unique ID of the AssignmentSubmission",
    example: 1,
  })
  id: number;

  @ApiProperty({
    description: "The ID of the assignment that this submission corresponds to",
    example: 2,
  })
  assignmentId: number;

  @ApiProperty({
    description: "The current state of the assignment",
    enum: AssignmentSubmissionState,
    enumName: "AssignmentSubmissionState",
    example: AssignmentSubmissionState.IN_PROGRESS,
  })
  state: AssignmentSubmissionState;

  @ApiProperty({
    description:
      "The list of responses provided by the learner for each of the questions in the assignment",
    isArray: true,
  })
  questionResponses: QuestionResponse[];
}
